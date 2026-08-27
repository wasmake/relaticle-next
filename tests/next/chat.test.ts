import { describe, expect, it, vi } from "vitest";

import { ChatCancellationRegistry } from "@/server/chat/cancellation";
import { ModelRegistry } from "@/server/chat/model-registry";
import { OpenAiProvider } from "@/server/chat/providers";
import type { ChatRepository, ProposalInput, SaveMessageInput } from "@/server/chat/repository";
import { ChatService } from "@/server/chat/service";
import type { ChatToolbox, ToolExecution } from "@/server/chat/tools";
import type { ChatConversation, ChatIdentity, ChatMessage, ChatProvider, ChatReference, PendingActionView, ProviderToolCall, ToolDefinition } from "@/server/chat/types";
import { emptyUsage } from "@/server/chat/types";
import { ulidSchema } from "@/server/ids";
import { LocalChatTurnLock } from "@/server/chat/turn-lock";

const identity: ChatIdentity = { teamId: ulidSchema.parse("01J00000000000000000000001"), userId: ulidSchema.parse("01J00000000000000000000002") };
const now = new Date("2026-08-19T12:00:00.000Z");

class MemoryRepository implements ChatRepository {
    public conversations: ChatConversation[] = [];
    public messages: ChatMessage[] = [];
    public proposals: PendingActionView[] = [];
    public reserved: string[] = [];
    public settled: string[] = [];
    public refunded: string[] = [];

    public async createConversation(_identity: ChatIdentity, id: string, title: string): Promise<ChatConversation> { const item = { id, title, createdAt: now, updatedAt: now }; this.conversations.push(item); return item; }
    public async listConversations(_identity: ChatIdentity, search?: string): Promise<readonly ChatConversation[]> { return this.conversations.filter((item) => search === undefined || item.title.includes(search)); }
    public async findConversation(_identity: ChatIdentity, id: string): Promise<ChatConversation | undefined> { return this.conversations.find((item) => item.id === id); }
    public async renameConversation(_identity: ChatIdentity, id: string, title: string): Promise<boolean> { const index = this.conversations.findIndex((item) => item.id === id); if (index < 0) return false; this.conversations[index] = { ...this.conversations[index]!, title }; return true; }
    public async deleteConversation(_identity: ChatIdentity, id: string): Promise<boolean> { const length = this.conversations.length; this.conversations = this.conversations.filter((item) => item.id !== id); return length !== this.conversations.length; }
    public async listMessages(_identity: ChatIdentity, conversationId: string): Promise<readonly ChatMessage[]> { return this.messages.filter((item) => item.conversationId === conversationId); }
    public async saveMessage(input: SaveMessageInput): Promise<ChatMessage> { const message: ChatMessage = { id: input.id, conversationId: input.conversationId, role: input.role, content: input.content, document: input.document ?? {}, toolCalls: input.toolCalls ?? [], toolResults: input.toolResults ?? [], usage: input.usage ?? emptyUsage(), meta: input.meta ?? {}, createdAt: now, mentions: input.mentions ?? [], pageContext: input.pageContext ?? null, feedback: null, pendingActions: [] }; this.messages.push(message); return message; }
    public async createProposal(input: ProposalInput): Promise<PendingActionView> { const proposal: PendingActionView = { id: input.id, operation: input.operation, entityType: input.entityType, actionData: input.actionData, displayData: input.displayData, status: "pending", expiresAt: input.expiresAt, resultData: null }; this.proposals.push(proposal); return proposal; }
    public async getProposal(_identity: ChatIdentity, id: string): Promise<PendingActionView | undefined> { return this.proposals.find((item) => item.id === id); }
    public async claimProposal(_identity: ChatIdentity, id: string): Promise<PendingActionView | undefined> { const proposal = this.proposals.find((item) => item.id === id && item.status === "pending"); if (proposal === undefined) return undefined; const claimed = { ...proposal, status: "processing" as const }; this.proposals = this.proposals.map((item) => item.id === id ? claimed : item); return claimed; }
    public async releaseProposal(_identity: ChatIdentity, id: string): Promise<void> { this.proposals = this.proposals.map((item) => item.id === id && item.status === "processing" ? { ...item, status: "pending" } : item); }
    public async resolveProposal(_identity: ChatIdentity, id: string, status: "approved" | "rejected", resultData: Readonly<Record<string, unknown>> | null): Promise<PendingActionView | undefined> { const proposal = this.proposals.find((item) => item.id === id); if (proposal === undefined) return undefined; const updated = { ...proposal, status, resultData }; this.proposals = this.proposals.map((item) => item.id === id ? updated : item); return updated; }
    public async supersedePending(): Promise<number> { return 0; }
    public async saveFeedback(): Promise<void> {}
    public async deleteFeedback(): Promise<void> {}
    public async reserveCredit(_identity: ChatIdentity, key: string): Promise<boolean> { this.reserved.push(key); return true; }
    public async settleCredit(_identity: ChatIdentity, key: string): Promise<void> { this.settled.push(key); }
    public async refundCredit(_identity: ChatIdentity, key: string): Promise<void> { this.refunded.push(key); }
}

class FakeTools implements ChatToolbox {
    public approved: string[] = [];
    public definitions(): readonly ToolDefinition[] { return [{ name: "search_crm", description: "search", inputSchema: { type: "object" } }]; }
    public async execute(_identity: ChatIdentity, _conversationId: string, _messageId: string, call: ProviderToolCall): Promise<ToolExecution> { return { result: { callId: call.id, name: call.name, result: [{ label: "Acme" }] } }; }
    public async approve(_identity: ChatIdentity, action: PendingActionView): Promise<Readonly<Record<string, unknown>>> { this.approved.push(action.id); return { id: "record-1" }; }
    public async resolveReference(_identity: ChatIdentity, type: string, id: string): Promise<ChatReference | undefined> { return { type: type as ChatReference["type"], id, label: "Acme" }; }
    public async mentions(): Promise<readonly ChatReference[]> { return []; }
}

const descriptor = { id: "test", label: "Test", provider: "compatible" as const, model: "test-model", creditMultiplier: 1, supportsTools: true, selfHosted: true };

describe("chat service", () => {
    it("streams an injected provider, persists the turn, and settles reserved credits", async () => {
        const repository = new MemoryRepository();
        const tools = new FakeTools();
        const provider: ChatProvider = { async *stream() { yield { type: "text", text: "Hello " }; yield { type: "text", text: "Ada" }; yield { type: "usage", usage: { inputTokens: 12, outputTokens: 3 } }; } };
        const registry = new ModelRegistry([descriptor], { compatible: () => provider });
        const service = new ChatService(repository, registry, tools, new ChatCancellationRegistry());
        const conversation = await service.createConversation(identity, "Tell me about Acme");
        const events = [];
        for await (const event of service.send(identity, { conversationId: conversation.id, message: "Hello", model: "test" })) events.push(event);

        expect(events.filter((event) => event.type === "text_delta")).toHaveLength(2);
        expect(repository.messages.map((message) => [message.role, message.content])).toEqual([["user", "Hello"], ["assistant", "Hello Ada"]]);
        expect(repository.reserved).toHaveLength(1);
        expect(repository.settled).toHaveLength(1);
        expect(repository.refunded).toHaveLength(0);
    });

    it("resolves pending actions only through the approval toolbox", async () => {
        const repository = new MemoryRepository();
        const tools = new FakeTools();
        const service = new ChatService(repository, new ModelRegistry([descriptor], { compatible: () => ({ async *stream() {} }) }), tools, new ChatCancellationRegistry());
        const proposal = await repository.createProposal({ id: "action-1", identity, conversationId: "conversation-1", messageId: null, operation: "create", entityType: "company", actionData: { fields: { name: "Acme" } }, displayData: { label: "Acme" }, expiresAt: new Date(Date.now() + 60_000) });

        const resolved = await service.resolveAction(identity, proposal.id, "approve");
        expect(tools.approved).toEqual([proposal.id]);
        expect(resolved).toMatchObject({ status: "approved", resultData: { id: "record-1" } });
        await expect(service.resolveAction(identity, proposal.id, "approve")).resolves.toMatchObject({ status: "approved" });
        expect(tools.approved).toEqual([proposal.id]);
    });

    it("leases one turn per conversation and only releases the matching lease", async () => {
        const lock = new LocalChatTurnLock();
        const lease = await lock.acquire(identity, "conversation-1");
        expect(lease).toBeDefined();
        await expect(lock.acquire(identity, "conversation-1")).resolves.toBeUndefined();
        await lock.release({ key: lease!.key, token: "not-the-owner" });
        await expect(lock.acquire(identity, "conversation-1")).resolves.toBeUndefined();
        await lock.release(lease!);
        await expect(lock.acquire(identity, "conversation-1")).resolves.toBeDefined();
    });
});

describe("OpenAI-compatible provider", () => {
    it("uses injected fetch and parses text, tools, and usage from SSE", async () => {
        const fetcher = vi.fn(async () => new Response([
            'data: {"choices":[{"delta":{"content":"Hi"}}]}',
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"search_crm","arguments":"{\\"query\\":\\"Acme\\"}"}}]}}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}',
            "data: [DONE]", "",
        ].join("\n"), { status: 200, headers: { "content-type": "text/event-stream" } }));
        const provider = new OpenAiProvider({ baseUrl: "https://provider.invalid/v1", apiKey: "test" }, fetcher);
        const events = [];
        for await (const event of provider.stream({ model: "model", system: "system", messages: [], tools: [], signal: new AbortController().signal })) events.push(event);

        expect(fetcher).toHaveBeenCalledOnce();
        expect(events).toEqual([
            { type: "text", text: "Hi" },
            { type: "usage", usage: { inputTokens: 9, outputTokens: 2 } },
            { type: "tool_call", call: { id: "call-1", name: "search_crm", arguments: { query: "Acme" } } },
        ]);
    });
});
