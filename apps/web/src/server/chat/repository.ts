import type { ChatConversation, ChatIdentity, ChatMessage, ChatReference, PendingActionView, ProviderToolCall, ProviderUsage, ToolResult } from "./types";

export type SaveMessageInput = Readonly<{
    id: string;
    identity: ChatIdentity;
    conversationId: string;
    role: "user" | "assistant" | "tool";
    content: string;
    document?: unknown;
    toolCalls?: readonly ProviderToolCall[];
    toolResults?: readonly ToolResult[];
    usage?: ProviderUsage;
    meta?: Readonly<Record<string, unknown>>;
    mentions?: readonly ChatReference[];
    pageContext?: ChatReference | null;
}>;

export type ProposalInput = Readonly<{
    id: string;
    identity: ChatIdentity;
    conversationId: string;
    messageId: string | null;
    operation: "create" | "update" | "delete";
    entityType: "company" | "people" | "opportunity" | "task" | "note";
    actionData: Readonly<Record<string, unknown>>;
    displayData: Readonly<Record<string, unknown>>;
    expiresAt: Date;
}>;

export interface ChatRepository {
    createConversation(identity: ChatIdentity, id: string, title: string): Promise<ChatConversation>;
    listConversations(identity: ChatIdentity, search?: string, limit?: number): Promise<readonly ChatConversation[]>;
    findConversation(identity: ChatIdentity, id: string): Promise<ChatConversation | undefined>;
    renameConversation(identity: ChatIdentity, id: string, title: string): Promise<boolean>;
    deleteConversation(identity: ChatIdentity, id: string): Promise<boolean>;
    listMessages(identity: ChatIdentity, conversationId: string, before?: string, limit?: number): Promise<readonly ChatMessage[]>;
    saveMessage(input: SaveMessageInput): Promise<ChatMessage>;
    createProposal(input: ProposalInput): Promise<PendingActionView>;
    getProposal(identity: ChatIdentity, id: string): Promise<PendingActionView | undefined>;
    claimProposal(identity: ChatIdentity, id: string): Promise<PendingActionView | undefined>;
    releaseProposal(identity: ChatIdentity, id: string): Promise<void>;
    resolveProposal(identity: ChatIdentity, id: string, status: "approved" | "rejected", resultData: Readonly<Record<string, unknown>> | null): Promise<PendingActionView | undefined>;
    supersedePending(identity: ChatIdentity, conversationId: string): Promise<number>;
    saveFeedback(identity: ChatIdentity, messageId: string, rating: "up" | "down", category: string | null, comment: string | null): Promise<void>;
    deleteFeedback(identity: ChatIdentity, messageId: string): Promise<void>;
    reserveCredit(identity: ChatIdentity, key: string, conversationId: string): Promise<boolean>;
    settleCredit(identity: ChatIdentity, key: string, conversationId: string, model: string, usage: ProviderUsage, credits: number): Promise<void>;
    refundCredit(identity: ChatIdentity, key: string, conversationId: string): Promise<void>;
}
