import { sql } from "drizzle-orm";
import {
    check,
    foreignKey,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    unique,
    varchar,
} from "drizzle-orm/pg-core";

import { teams, users } from "./core";
import type { JsonValue } from "./shared";
import { laravelTimestamps, ulid } from "./shared";

export const agentConversations = pgTable(
    "agent_conversations",
    {
        id: varchar("id", { length: 36 }).primaryKey(),
        participantId: varchar("participant_id", { length: 255 }),
        teamId: ulid("team_id"),
        title: varchar("title", { length: 255 }).notNull(),
        ...laravelTimestamps(),
        participantType: varchar("participant_type", { length: 255 }),
    },
    (table) => [
        foreignKey({
            name: "agent_conversations_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        index("participant_updated_at_index").on(
            table.participantType,
            table.participantId,
            table.updatedAt,
        ),
        index("team_participant_updated_at_index").on(
            table.teamId,
            table.participantType,
            table.participantId,
            table.updatedAt,
        ),
    ],
);

export const agentConversationMessages = pgTable(
    "agent_conversation_messages",
    {
        id: varchar("id", { length: 36 }).primaryKey(),
        conversationId: varchar("conversation_id", { length: 36 }).notNull(),
        participantId: varchar("participant_id", { length: 255 }),
        agent: varchar("agent", { length: 255 }).notNull(),
        role: varchar("role", { length: 25 }).notNull(),
        content: text("content").notNull(),
        attachments: jsonb("attachments").$type<JsonValue>().notNull(),
        toolCalls: jsonb("tool_calls").$type<JsonValue>().notNull(),
        toolResults: jsonb("tool_results").$type<JsonValue>().notNull(),
        usage: jsonb("usage").$type<JsonValue>().notNull(),
        meta: jsonb("meta").$type<JsonValue>().notNull(),
        ...laravelTimestamps(),
        document: jsonb("document")
            .$type<JsonValue>()
            .default(sql`'{"type":"doc","content":[]}'::jsonb`)
            .notNull(),
        supersededAt: timestamp("superseded_at", { mode: "date" }),
        participantType: varchar("participant_type", { length: 255 }),
        approvalState: text("approval_state"),
    },
    (table) => [
        foreignKey({
            name: "agent_conversation_messages_conversation_id_foreign",
            columns: [table.conversationId],
            foreignColumns: [agentConversations.id],
        }).onDelete("cascade"),
        index("conversation_index").on(
            table.conversationId,
            table.participantType,
            table.participantId,
            table.updatedAt,
        ),
        index("participant_index").on(
            table.participantType,
            table.participantId,
        ),
    ],
);

export const agentConversationMessageMentions = pgTable(
    "agent_conversation_message_mentions",
    {
        id: ulid("id").primaryKey(),
        messageId: varchar("message_id", { length: 36 }).notNull(),
        type: varchar("type", { length: 32 }).notNull(),
        recordId: ulid("record_id").notNull(),
        label: varchar("label", { length: 255 }).notNull(),
        source: varchar("source", { length: 32 })
            .default("mention")
            .notNull(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "agent_conversation_message_mentions_message_id_foreign",
            columns: [table.messageId],
            foreignColumns: [agentConversationMessages.id],
        }).onDelete("cascade"),
        index("agent_conversation_message_mentions_message_id_type_index").on(
            table.messageId,
            table.type,
        ),
        index("agent_conversation_message_mentions_type_record_id_index").on(
            table.type,
            table.recordId,
        ),
        index(
            "agent_conversation_message_mentions_message_id_source_index",
        ).on(table.messageId, table.source),
    ],
);

export const aiCreditBalances = pgTable(
    "ai_credit_balances",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id").notNull(),
        creditsRemaining: integer("credits_remaining").default(0).notNull(),
        creditsUsed: integer("credits_used").default(0).notNull(),
        periodStartsAt: timestamp("period_starts_at", {
            mode: "date",
        }).notNull(),
        periodEndsAt: timestamp("period_ends_at", {
            mode: "date",
        }).notNull(),
        ...laravelTimestamps(),
        purchasedCredits: integer("purchased_credits").default(0).notNull(),
    },
    (table) => [
        foreignKey({
            name: "ai_credit_balances_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        unique("ai_credit_balances_team_id_unique").on(table.teamId),
        check(
            "ai_credit_balances_credits_nonneg",
            sql`${table.creditsRemaining} >= 0`,
        ),
        check(
            "ai_credit_balances_credits_used_nonneg",
            sql`${table.creditsUsed} >= 0`,
        ),
        check(
            "ai_credit_balances_period_order",
            sql`${table.periodStartsAt} < ${table.periodEndsAt}`,
        ),
        check(
            "ai_credit_balances_purchased_nonneg",
            sql`${table.purchasedCredits} >= 0`,
        ),
        check(
            "ai_credit_balances_purchased_lte_remaining",
            sql`${table.purchasedCredits} <= ${table.creditsRemaining}`,
        ),
    ],
);

export const aiCreditTransactions = pgTable(
    "ai_credit_transactions",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id").notNull(),
        userId: ulid("user_id"),
        conversationId: varchar("conversation_id", { length: 36 }),
        idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
        type: varchar("type", { length: 255 }).notNull(),
        model: varchar("model", { length: 255 }).notNull(),
        inputTokens: integer("input_tokens").default(0).notNull(),
        outputTokens: integer("output_tokens").default(0).notNull(),
        creditsCharged: integer("credits_charged").default(0).notNull(),
        metadata: jsonb("metadata").$type<JsonValue>(),
        createdAt: timestamp("created_at", { mode: "date" }).notNull(),
    },
    (table) => [
        foreignKey({
            name: "ai_credit_transactions_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "ai_credit_transactions_user_id_foreign",
            columns: [table.userId],
            foreignColumns: [users.id],
        }).onDelete("set null"),
        foreignKey({
            name: "ai_credit_transactions_conversation_id_foreign",
            columns: [table.conversationId],
            foreignColumns: [agentConversations.id],
        }).onDelete("set null"),
        index("ai_credit_transactions_team_id_created_at_index").on(
            table.teamId,
            table.createdAt,
        ),
        index("ai_credit_transactions_type_created_at_index").on(
            table.type,
            table.createdAt,
        ),
        index("ai_credit_transactions_conversation_id_index").on(
            table.conversationId,
        ),
        index(
            "ai_credit_transactions_team_id_user_id_created_at_index",
        ).on(table.teamId, table.userId, table.createdAt),
        unique("ai_credit_transactions_team_id_idempotency_key_unique").on(
            table.teamId,
            table.idempotencyKey,
        ),
        check(
            "ai_credit_transactions_input_tokens_nonneg",
            sql`${table.inputTokens} >= 0`,
        ),
        check(
            "ai_credit_transactions_output_tokens_nonneg",
            sql`${table.outputTokens} >= 0`,
        ),
        check(
            "ai_credit_transactions_credits_charged_nonneg",
            sql`${table.creditsCharged} >= 0`,
        ),
    ],
);

export const pendingActions = pgTable(
    "pending_actions",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id").notNull(),
        userId: ulid("user_id").notNull(),
        conversationId: varchar("conversation_id", { length: 36 }),
        messageId: varchar("message_id", { length: 36 }),
        actionClass: varchar("action_class", { length: 255 }).notNull(),
        operation: varchar("operation", { length: 255 }).notNull(),
        entityType: varchar("entity_type", { length: 255 }).notNull(),
        actionData: jsonb("action_data").$type<JsonValue>().notNull(),
        displayData: jsonb("display_data").$type<JsonValue>().notNull(),
        status: varchar("status", { length: 255 })
            .default("pending")
            .notNull(),
        expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
        resolvedAt: timestamp("resolved_at", { mode: "date" }),
        resultData: jsonb("result_data").$type<JsonValue>(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "pending_actions_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "pending_actions_user_id_foreign",
            columns: [table.userId],
            foreignColumns: [users.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "pending_actions_conversation_id_foreign",
            columns: [table.conversationId],
            foreignColumns: [agentConversations.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "pending_actions_message_id_foreign",
            columns: [table.messageId],
            foreignColumns: [agentConversationMessages.id],
        }).onDelete("set null"),
        index("pending_actions_team_id_status_index").on(
            table.teamId,
            table.status,
        ),
        index("pending_actions_conversation_id_status_index").on(
            table.conversationId,
            table.status,
        ),
        index("pending_actions_expires_at_index").on(table.expiresAt),
        index("pending_actions_status_expires_at_index").on(
            table.status,
            table.expiresAt,
        ),
        index("pending_actions_team_id_user_id_status_index").on(
            table.teamId,
            table.userId,
            table.status,
        ),
        index("pending_actions_message_id_index").on(table.messageId),
    ],
);

export const chatMessageFeedback = pgTable(
    "chat_message_feedback",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id").notNull(),
        userId: ulid("user_id").notNull(),
        conversationId: varchar("conversation_id", { length: 36 }).notNull(),
        messageId: varchar("message_id", { length: 36 }).notNull(),
        rating: varchar("rating", { length: 8 }).notNull(),
        category: varchar("category", { length: 32 }),
        comment: varchar("comment", { length: 1000 }),
        model: varchar("model", { length: 64 }),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "chat_message_feedback_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "chat_message_feedback_user_id_foreign",
            columns: [table.userId],
            foreignColumns: [users.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "chat_message_feedback_conversation_id_foreign",
            columns: [table.conversationId],
            foreignColumns: [agentConversations.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "chat_message_feedback_message_id_foreign",
            columns: [table.messageId],
            foreignColumns: [agentConversationMessages.id],
        }).onDelete("cascade"),
        unique("chat_message_feedback_user_id_message_id_unique").on(
            table.userId,
            table.messageId,
        ),
        index("chat_message_feedback_team_id_rating_created_at_index").on(
            table.teamId,
            table.rating,
            table.createdAt,
        ),
    ],
);
