import type { ChatProvider, ProviderEvent, ProviderRequest, ProviderUsage } from "./types";

export type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const parseObject = (value: string): Readonly<Record<string, unknown>> => {
    try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Readonly<Record<string, unknown>> : {};
    } catch {
        return {};
    }
};

async function* responseLines(response: Response): AsyncGenerator<string> {
    if (!response.ok) throw new Error(`Provider request failed (${response.status}).`);
    if (response.body === null) throw new Error("Provider returned an empty stream.");
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += value;
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) yield line.trim();
        }
        if (buffer.trim() !== "") yield buffer.trim();
    } finally {
        reader.releaseLock();
    }
}

const openAiTools = (request: ProviderRequest) => request.tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
}));

const openAiMessages = (request: ProviderRequest) => [{ role: "system", content: request.system }, ...request.messages.map((message) => {
    if (message.role === "tool") return { role: "tool", content: message.content, tool_call_id: message.toolCallId };
    if (message.role === "assistant" && message.toolCalls !== undefined) return { role: "assistant", content: message.content, tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) };
    return { role: message.role, content: message.content };
})];

const anthropicMessages = (request: ProviderRequest) => request.messages.map((message) => {
    if (message.role === "tool") return { role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] };
    if (message.role === "assistant" && message.toolCalls !== undefined) return { role: "assistant", content: message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.arguments })) };
    return { role: message.role, content: message.content };
});

export class OpenAiProvider implements ChatProvider {
    public constructor(
        private readonly configuration: Readonly<{ baseUrl: string; apiKey?: string }>,
        private readonly fetcher: FetchPort = fetch,
    ) {}

    public async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const headers = new Headers({ "content-type": "application/json", accept: "text/event-stream" });
        if (this.configuration.apiKey !== undefined) headers.set("authorization", `Bearer ${this.configuration.apiKey}`);
        const response = await this.fetcher(`${this.configuration.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
            method: "POST", headers, signal: request.signal,
            body: JSON.stringify({ model: request.model, stream: true, stream_options: { include_usage: true }, messages: openAiMessages(request), tools: openAiTools(request) }),
        });
        const calls = new Map<number, { id: string; name: string; arguments: string }>();
        for await (const line of responseLines(response)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") break;
            const packet = parseObject(data);
            const choice = Array.isArray(packet.choices) ? packet.choices[0] as Record<string, unknown> | undefined : undefined;
            const delta = choice?.delta as Record<string, unknown> | undefined;
            if (typeof delta?.content === "string") yield { type: "text", text: delta.content };
            if (Array.isArray(delta?.tool_calls)) {
                for (const raw of delta.tool_calls as Record<string, unknown>[]) {
                    const index = typeof raw.index === "number" ? raw.index : 0;
                    const fn = raw.function as Record<string, unknown> | undefined;
                    const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
                    calls.set(index, { id: typeof raw.id === "string" ? raw.id : current.id, name: typeof fn?.name === "string" ? current.name + fn.name : current.name, arguments: typeof fn?.arguments === "string" ? current.arguments + fn.arguments : current.arguments });
                }
            }
            const usage = packet.usage as Record<string, unknown> | undefined;
            if (usage !== undefined) yield { type: "usage", usage: { inputTokens: Number(usage.prompt_tokens ?? 0), outputTokens: Number(usage.completion_tokens ?? 0) } };
        }
        for (const call of calls.values()) yield { type: "tool_call", call: { id: call.id, name: call.name, arguments: parseObject(call.arguments) } };
    }
}

export class AnthropicProvider implements ChatProvider {
    public constructor(
        private readonly configuration: Readonly<{ baseUrl: string; apiKey: string }>,
        private readonly fetcher: FetchPort = fetch,
    ) {}

    public async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const response = await this.fetcher(`${this.configuration.baseUrl.replace(/\/$/u, "")}/messages`, {
            method: "POST", signal: request.signal,
            headers: { "content-type": "application/json", accept: "text/event-stream", "x-api-key": this.configuration.apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model: request.model, max_tokens: 4096, stream: true, system: request.system, messages: anthropicMessages(request), tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })) }),
        });
        let call: { id: string; name: string; arguments: string } | undefined;
        for await (const line of responseLines(response)) {
            if (!line.startsWith("data:")) continue;
            const packet = parseObject(line.slice(5).trim());
            const block = packet.content_block as Record<string, unknown> | undefined;
            const delta = packet.delta as Record<string, unknown> | undefined;
            if (packet.type === "content_block_start" && block?.type === "tool_use") call = { id: String(block.id ?? ""), name: String(block.name ?? ""), arguments: "" };
            if (packet.type === "content_block_delta" && delta?.type === "text_delta" && typeof delta.text === "string") yield { type: "text", text: delta.text };
            if (packet.type === "content_block_delta" && delta?.type === "input_json_delta" && call !== undefined) call.arguments += String(delta.partial_json ?? "");
            if (packet.type === "content_block_stop" && call !== undefined) { yield { type: "tool_call", call: { id: call.id, name: call.name, arguments: parseObject(call.arguments) } }; call = undefined; }
            const usage = packet.usage as Record<string, unknown> | undefined;
            if (usage !== undefined) yield { type: "usage", usage: { inputTokens: Number(usage.input_tokens ?? 0), outputTokens: Number(usage.output_tokens ?? 0) } };
        }
    }
}

export class OllamaProvider implements ChatProvider {
    public constructor(private readonly baseUrl: string, private readonly fetcher: FetchPort = fetch) {}

    public async *stream(request: ProviderRequest): AsyncIterable<ProviderEvent> {
        const response = await this.fetcher(`${this.baseUrl.replace(/\/$/u, "")}/api/chat`, {
            method: "POST", signal: request.signal, headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: request.model, stream: true, messages: openAiMessages(request), tools: openAiTools(request) }),
        });
        for await (const line of responseLines(response)) {
            if (line === "") continue;
            const packet = parseObject(line);
            const message = packet.message as Record<string, unknown> | undefined;
            if (typeof message?.content === "string" && message.content !== "") yield { type: "text", text: message.content };
            if (Array.isArray(message?.tool_calls)) {
                for (const item of message.tool_calls as Record<string, unknown>[]) {
                    const fn = item.function as Record<string, unknown> | undefined;
                    if (typeof fn?.name === "string") yield { type: "tool_call", call: { id: crypto.randomUUID(), name: fn.name, arguments: typeof fn.arguments === "object" && fn.arguments !== null ? fn.arguments as Record<string, unknown> : {} } };
                }
            }
            if (packet.done === true) yield { type: "usage", usage: { inputTokens: Number(packet.prompt_eval_count ?? 0), outputTokens: Number(packet.eval_count ?? 0) } };
        }
    }
}

export const mergeUsage = (left: ProviderUsage, right: ProviderUsage): ProviderUsage => ({ inputTokens: left.inputTokens + right.inputTokens, outputTokens: left.outputTokens + right.outputTokens });
