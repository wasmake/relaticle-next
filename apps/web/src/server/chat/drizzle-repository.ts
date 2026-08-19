import { and, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { agentConversationMessageMentions, agentConversationMessages, agentConversations, aiCreditBalances, aiCreditTransactions, chatMessageFeedback, pendingActions, teams } from "@/server/db/schema";
import type { JsonValue } from "@/server/db/schema/shared";
import { createUlid } from "@/server/ids";

import type { ChatRepository, ProposalInput, SaveMessageInput } from "./repository";
import type { ChatConversation, ChatIdentity, ChatMessage, ChatReference, PendingActionView, ProviderToolCall, ProviderUsage, ToolResult } from "./types";
import { emptyUsage } from "./types";

type Database = ReturnType<typeof getDatabase>;
const participantType = "App\\Models\\User";
const json = (value: unknown): JsonValue => value as JsonValue;
const object = (value: unknown): Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
const array = <T>(value: unknown): readonly T[] => Array.isArray(value) ? value as readonly T[] : [];

const conversationView = (row: typeof agentConversations.$inferSelect): ChatConversation => ({ id: row.id, title: row.title, createdAt: row.createdAt, updatedAt: row.updatedAt });
const proposalView = (row: typeof pendingActions.$inferSelect): PendingActionView => ({
    id: row.id,
    operation: row.operation as PendingActionView["operation"],
    entityType: row.entityType as PendingActionView["entityType"],
    actionData: object(row.actionData),
    displayData: object(row.displayData),
    status: row.status as PendingActionView["status"],
    expiresAt: row.expiresAt,
    resultData: row.resultData === null ? null : object(row.resultData),
});

export class DrizzleChatRepository implements ChatRepository {
    public constructor(private readonly database: Database = getDatabase(), private readonly now: () => Date = () => new Date()) {}

    private owned(identity: ChatIdentity) {
        return and(eq(agentConversations.teamId, identity.teamId), eq(agentConversations.participantType, participantType), eq(agentConversations.participantId, identity.userId));
    }

    public async createConversation(identity: ChatIdentity, id: string, title: string): Promise<ChatConversation> {
        const now = this.now();
        const [row] = await this.database.insert(agentConversations).values({ id, teamId: identity.teamId, participantType, participantId: identity.userId, title, createdAt: now, updatedAt: now }).returning();
        if (row === undefined) throw new Error("Conversation was not created.");
        return conversationView(row);
    }

    public async listConversations(identity: ChatIdentity, search?: string, limit = 50): Promise<readonly ChatConversation[]> {
        const term = search?.trim();
        const rows = await this.database.select().from(agentConversations).where(and(this.owned(identity), term === undefined || term === "" ? undefined : ilike(agentConversations.title, `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`))).orderBy(desc(agentConversations.updatedAt)).limit(Math.min(Math.max(limit, 1), 100));
        return rows.map(conversationView);
    }

    public async findConversation(identity: ChatIdentity, id: string): Promise<ChatConversation | undefined> {
        const [row] = await this.database.select().from(agentConversations).where(and(this.owned(identity), eq(agentConversations.id, id))).limit(1);
        return row === undefined ? undefined : conversationView(row);
    }

    public async renameConversation(identity: ChatIdentity, id: string, title: string): Promise<boolean> {
        const rows = await this.database.update(agentConversations).set({ title, updatedAt: this.now() }).where(and(this.owned(identity), eq(agentConversations.id, id))).returning({ id: agentConversations.id });
        return rows.length > 0;
    }

    public async deleteConversation(identity: ChatIdentity, id: string): Promise<boolean> {
        const rows = await this.database.delete(agentConversations).where(and(this.owned(identity), eq(agentConversations.id, id))).returning({ id: agentConversations.id });
        return rows.length > 0;
    }

    public async listMessages(identity: ChatIdentity, conversationId: string, before?: string, limit = 50): Promise<readonly ChatMessage[]> {
        const owned = await this.findConversation(identity, conversationId);
        if (owned === undefined) return [];
        const rows = await this.database.select().from(agentConversationMessages).where(and(eq(agentConversationMessages.conversationId, conversationId), isNull(agentConversationMessages.supersededAt), before === undefined ? undefined : lt(agentConversationMessages.id, before))).orderBy(desc(agentConversationMessages.id)).limit(Math.min(Math.max(limit, 1), 100));
        rows.reverse();
        const ids = rows.map((row) => row.id);
        const [mentions, feedback, proposals] = ids.length === 0 ? [[], [], []] : await Promise.all([
            this.database.select().from(agentConversationMessageMentions).where(inArray(agentConversationMessageMentions.messageId, ids)),
            this.database.select().from(chatMessageFeedback).where(and(eq(chatMessageFeedback.userId, identity.userId), inArray(chatMessageFeedback.messageId, ids))),
            this.database.select().from(pendingActions).where(and(eq(pendingActions.teamId, identity.teamId), or(inArray(pendingActions.messageId, ids), eq(pendingActions.conversationId, conversationId)))),
        ]);
        return rows.map((row, rowIndex) => {
            const refs = mentions.filter((item) => item.messageId === row.id).map((item) => ({ type: item.type as ChatReference["type"], id: item.recordId, label: item.label }));
            const pageContext = mentions.find((item) => item.messageId === row.id && item.source === "page_context");
            const rating = feedback.find((item) => item.messageId === row.id);
            return {
                id: row.id, conversationId, role: row.role as ChatMessage["role"], content: row.content, document: row.document,
                toolCalls: array<ProviderToolCall>(row.toolCalls), toolResults: array<ToolResult>(row.toolResults), usage: { ...emptyUsage(), ...object(row.usage) } as ProviderUsage,
                meta: object(row.meta), createdAt: row.createdAt,
                mentions: refs.filter((_item, index) => mentions.filter((item) => item.messageId === row.id)[index]?.source !== "page_context"),
                pageContext: pageContext === undefined ? null : { type: pageContext.type as ChatReference["type"], id: pageContext.recordId, label: pageContext.label },
                feedback: rating === undefined ? null : { rating: rating.rating as "up" | "down", category: rating.category },
                pendingActions: row.role === "assistant" ? proposals.filter((item) => item.messageId === rows[rowIndex - 1]?.id).map(proposalView) : [],
            };
        });
    }

    public async saveMessage(input: SaveMessageInput): Promise<ChatMessage> {
        const now = this.now();
        const [row] = await this.database.insert(agentConversationMessages).values({
            id: input.id, conversationId: input.conversationId, participantType, participantId: input.identity.userId, agent: "Relaticle\\Chat\\Agents\\CrmAssistant", role: input.role, content: input.content,
            attachments: json([]), toolCalls: json(input.toolCalls ?? []), toolResults: json(input.toolResults ?? []), usage: json(input.usage ?? emptyUsage()), meta: json(input.meta ?? {}), document: json(input.document ?? { type: "doc", content: [] }), createdAt: now, updatedAt: now,
        }).returning();
        if (row === undefined) throw new Error("Message was not saved.");
        const references = [...(input.mentions ?? []), ...(input.pageContext === null || input.pageContext === undefined ? [] : [input.pageContext])];
        if (references.length > 0) await this.database.insert(agentConversationMessageMentions).values(references.map((reference, index) => ({ id: createUlid(), messageId: input.id, type: reference.type, recordId: reference.id, label: reference.label, source: index < (input.mentions?.length ?? 0) ? "mention" : "page_context", createdAt: now, updatedAt: now })));
        await this.database.update(agentConversations).set({ updatedAt: now }).where(eq(agentConversations.id, input.conversationId));
        return { id: row.id, conversationId: input.conversationId, role: input.role, content: input.content, document: row.document, toolCalls: input.toolCalls ?? [], toolResults: input.toolResults ?? [], usage: input.usage ?? emptyUsage(), meta: input.meta ?? {}, createdAt: now, mentions: input.mentions ?? [], pageContext: input.pageContext ?? null, feedback: null, pendingActions: [] };
    }

    public async createProposal(input: ProposalInput): Promise<PendingActionView> {
        const now = this.now();
        const [existing] = await this.database.select().from(pendingActions).where(and(eq(pendingActions.conversationId, input.conversationId), eq(pendingActions.userId, input.identity.userId), eq(pendingActions.status, "pending"), eq(pendingActions.actionClass, `chat:${input.entityType}:${input.operation}`), sql`${pendingActions.actionData} = ${json(input.actionData)}::jsonb`)).limit(1);
        if (existing !== undefined) return proposalView(existing);
        const [row] = await this.database.insert(pendingActions).values({ id: input.id, teamId: input.identity.teamId, userId: input.identity.userId, conversationId: input.conversationId, messageId: input.messageId, actionClass: `chat:${input.entityType}:${input.operation}`, operation: input.operation, entityType: input.entityType, actionData: json(input.actionData), displayData: json(input.displayData), status: "pending", expiresAt: input.expiresAt, createdAt: now, updatedAt: now }).returning();
        if (row === undefined) throw new Error("Proposal was not created.");
        return proposalView(row);
    }

    public async getProposal(identity: ChatIdentity, id: string): Promise<PendingActionView | undefined> {
        const [row] = await this.database.select().from(pendingActions).where(and(eq(pendingActions.id, id), eq(pendingActions.teamId, identity.teamId), eq(pendingActions.userId, identity.userId))).limit(1);
        return row === undefined ? undefined : proposalView(row);
    }

    public async claimProposal(identity: ChatIdentity, id: string): Promise<PendingActionView | undefined> {
        const now = this.now();
        const [row] = await this.database.update(pendingActions).set({ status: "processing", updatedAt: now }).where(and(eq(pendingActions.id, id), eq(pendingActions.teamId, identity.teamId), eq(pendingActions.userId, identity.userId), eq(pendingActions.status, "pending"), gt(pendingActions.expiresAt, now))).returning();
        return row === undefined ? undefined : proposalView(row);
    }

    public async releaseProposal(identity: ChatIdentity, id: string): Promise<void> {
        await this.database.update(pendingActions).set({ status: "pending", updatedAt: this.now() }).where(and(eq(pendingActions.id, id), eq(pendingActions.teamId, identity.teamId), eq(pendingActions.userId, identity.userId), eq(pendingActions.status, "processing")));
    }

    public async resolveProposal(identity: ChatIdentity, id: string, status: "approved" | "rejected", resultData: Readonly<Record<string, unknown>> | null): Promise<PendingActionView | undefined> {
        const now = this.now();
        const [row] = await this.database.update(pendingActions).set({ status, resultData: resultData === null ? null : json(resultData), resolvedAt: now, updatedAt: now }).where(and(eq(pendingActions.id, id), eq(pendingActions.teamId, identity.teamId), eq(pendingActions.userId, identity.userId), eq(pendingActions.status, status === "approved" ? "processing" : "pending"), status === "approved" ? undefined : gt(pendingActions.expiresAt, now))).returning();
        return row === undefined ? undefined : proposalView(row);
    }

    public async supersedePending(identity: ChatIdentity, conversationId: string): Promise<number> {
        const now = this.now();
        const rows = await this.database.update(pendingActions).set({ status: "superseded", resolvedAt: now, updatedAt: now }).where(and(eq(pendingActions.teamId, identity.teamId), eq(pendingActions.userId, identity.userId), eq(pendingActions.conversationId, conversationId), eq(pendingActions.status, "pending"))).returning({ id: pendingActions.id });
        return rows.length;
    }

    public async saveFeedback(identity: ChatIdentity, messageId: string, rating: "up" | "down", category: string | null, comment: string | null): Promise<void> {
        const [message] = await this.database.select({ conversationId: agentConversationMessages.conversationId, model: agentConversationMessages.meta }).from(agentConversationMessages).innerJoin(agentConversations, eq(agentConversations.id, agentConversationMessages.conversationId)).where(and(eq(agentConversationMessages.id, messageId), this.owned(identity))).limit(1);
        if (message === undefined) throw new Error("Message not found.");
        const now = this.now();
        await this.database.insert(chatMessageFeedback).values({ id: createUlid(), teamId: identity.teamId, userId: identity.userId, conversationId: message.conversationId, messageId, rating, category, comment, model: typeof object(message.model).model === "string" ? object(message.model).model as string : null, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [chatMessageFeedback.userId, chatMessageFeedback.messageId], set: { rating, category, comment, updatedAt: now } });
    }

    public async deleteFeedback(identity: ChatIdentity, messageId: string): Promise<void> {
        await this.database.delete(chatMessageFeedback).where(and(eq(chatMessageFeedback.teamId, identity.teamId), eq(chatMessageFeedback.userId, identity.userId), eq(chatMessageFeedback.messageId, messageId)));
    }

    public async reserveCredit(identity: ChatIdentity, key: string, conversationId: string): Promise<boolean> {
        return this.database.transaction(async (tx) => {
            const [prior] = await tx.select({ id: aiCreditTransactions.id }).from(aiCreditTransactions).where(and(eq(aiCreditTransactions.teamId, identity.teamId), eq(aiCreditTransactions.idempotencyKey, key))).limit(1);
            if (prior !== undefined) return true;
            const [team] = await tx.select({ plan: teams.plan }).from(teams).where(eq(teams.id, identity.teamId)).limit(1);
            const now = this.now();
            const periodEnd = new Date(now);
            periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
            const allowance = team?.plan === "pro" ? 500 : 50;
            await tx.insert(aiCreditBalances).values({ id: createUlid(), teamId: identity.teamId, creditsRemaining: allowance, creditsUsed: 0, purchasedCredits: 0, periodStartsAt: now, periodEndsAt: periodEnd, createdAt: now, updatedAt: now }).onConflictDoNothing();
            const [balance] = await tx.update(aiCreditBalances).set({ creditsRemaining: sql`${aiCreditBalances.creditsRemaining} - 1`, creditsUsed: sql`${aiCreditBalances.creditsUsed} + 1`, updatedAt: this.now() }).where(and(eq(aiCreditBalances.teamId, identity.teamId), gt(aiCreditBalances.creditsRemaining, 0))).returning();
            if (balance === undefined) return false;
            await tx.insert(aiCreditTransactions).values({ id: createUlid(), teamId: identity.teamId, userId: identity.userId, conversationId, idempotencyKey: key, type: "reservation", model: "system", creditsCharged: 1, inputTokens: 0, outputTokens: 0, metadata: json({ reason: "upfront_reservation" }), createdAt: this.now() });
            return true;
        });
    }

    public async settleCredit(identity: ChatIdentity, key: string, conversationId: string, model: string, usage: ProviderUsage, credits: number): Promise<void> {
        await this.resolveCredit(identity, key, conversationId, "chat", model, usage, credits, 1 - credits);
    }

    public async refundCredit(identity: ChatIdentity, key: string, conversationId: string): Promise<void> {
        await this.resolveCredit(identity, key, conversationId, "refund", "system", emptyUsage(), 1, 1);
    }

    private async resolveCredit(identity: ChatIdentity, key: string, conversationId: string, type: string, model: string, usage: ProviderUsage, credits: number, remainingDelta: number): Promise<void> {
        await this.database.transaction(async (tx) => {
            const inserted = await tx.insert(aiCreditTransactions).values({ id: createUlid(), teamId: identity.teamId, userId: identity.userId, conversationId, idempotencyKey: key, type, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, creditsCharged: credits, metadata: json({ reservation: true }), createdAt: this.now() }).onConflictDoNothing().returning({ id: aiCreditTransactions.id });
            if (inserted.length === 0 || remainingDelta === 0) return;
            await tx.update(aiCreditBalances).set({ creditsRemaining: sql`greatest(${aiCreditBalances.creditsRemaining} + ${remainingDelta}, 0)`, creditsUsed: sql`greatest(${aiCreditBalances.creditsUsed} - ${remainingDelta}, 0)`, purchasedCredits: sql`least(${aiCreditBalances.purchasedCredits}, greatest(${aiCreditBalances.creditsRemaining} + ${remainingDelta}, 0))`, updatedAt: this.now() }).where(eq(aiCreditBalances.teamId, identity.teamId));
        });
    }
}
