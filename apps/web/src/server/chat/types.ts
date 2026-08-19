import type { RequestContext } from "@/server/context/request-context";

export type ChatRole = "user" | "assistant" | "tool";
export type ChatEntityType = "company" | "people" | "opportunity" | "task" | "note";
export type ChatOperation = "create" | "update" | "delete";

export type ChatReference = Readonly<{
    type: ChatEntityType;
    id: string;
    label: string;
    url?: string;
}>;

export type ChatConversation = Readonly<{
    id: string;
    title: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type PendingActionView = Readonly<{
    id: string;
    operation: ChatOperation;
    entityType: ChatEntityType;
    actionData: Readonly<Record<string, unknown>>;
    displayData: Readonly<Record<string, unknown>>;
    status: "pending" | "processing" | "approved" | "rejected" | "expired" | "superseded";
    expiresAt: Date;
    resultData: Readonly<Record<string, unknown>> | null;
}>;

export type ChatMessage = Readonly<{
    id: string;
    conversationId: string;
    role: ChatRole;
    content: string;
    document: unknown;
    toolCalls: readonly ProviderToolCall[];
    toolResults: readonly ToolResult[];
    usage: ProviderUsage;
    meta: Readonly<Record<string, unknown>>;
    createdAt: Date | null;
    mentions: readonly ChatReference[];
    pageContext: ChatReference | null;
    feedback: Readonly<{ rating: "up" | "down"; category: string | null }> | null;
    pendingActions: readonly PendingActionView[];
}>;

export type ProviderMessage = Readonly<{
    role: ChatRole;
    content: string;
    toolCallId?: string;
    toolCalls?: readonly ProviderToolCall[];
}>;

export type ProviderToolCall = Readonly<{
    id: string;
    name: string;
    arguments: Readonly<Record<string, unknown>>;
}>;

export type ProviderUsage = Readonly<{
    inputTokens: number;
    outputTokens: number;
}>;

export type ProviderEvent =
    | Readonly<{ type: "text"; text: string }>
    | Readonly<{ type: "tool_call"; call: ProviderToolCall }>
    | Readonly<{ type: "usage"; usage: ProviderUsage }>;

export type ToolDefinition = Readonly<{
    name: string;
    description: string;
    inputSchema: Readonly<Record<string, unknown>>;
}>;

export type ProviderRequest = Readonly<{
    model: string;
    system: string;
    messages: readonly ProviderMessage[];
    tools: readonly ToolDefinition[];
    signal: AbortSignal;
}>;

export interface ChatProvider {
    stream(request: ProviderRequest): AsyncIterable<ProviderEvent>;
    complete?(request: Omit<ProviderRequest, "tools">): Promise<string>;
}

export type ModelDescriptor = Readonly<{
    id: string;
    label: string;
    provider: "openai" | "anthropic" | "ollama" | "compatible";
    model: string;
    creditMultiplier: number;
    supportsTools: boolean;
    selfHosted: boolean;
}>;

export type ToolResult = Readonly<{
    callId: string;
    name: string;
    result: unknown;
}>;

export type ChatIdentity = Pick<RequestContext, "teamId" | "userId">;

export type StreamEvent =
    | Readonly<{ type: "start"; conversationId: string; messageId: string; model: string }>
    | Readonly<{ type: "text_delta"; delta: string }>
    | Readonly<{ type: "tool"; name: string }>
    | Readonly<{ type: "proposal"; action: PendingActionView }>
    | Readonly<{ type: "usage"; inputTokens: number; outputTokens: number; credits: number }>
    | Readonly<{ type: "title"; title: string }>
    | Readonly<{ type: "done"; message: ChatMessage }>
    | Readonly<{ type: "error"; code: string; message: string }>
    | Readonly<{ type: "cancelled"; message: string }>;

export const emptyUsage = (): ProviderUsage => ({ inputTokens: 0, outputTokens: 0 });
