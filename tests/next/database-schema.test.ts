import { is } from "drizzle-orm";
import {
    type AnyPgColumn,
    getTableConfig,
    PgTable,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";

const activeTableNames = [
    "activity_log",
    "agent_conversation_message_mentions",
    "agent_conversation_messages",
    "agent_conversations",
    "ai_credit_balances",
    "ai_credit_transactions",
    "blog_categories",
    "blog_post_tag",
    "blog_posts",
    "blog_tags",
    "cache",
    "cache_locks",
    "chat_message_feedback",
    "companies",
    "custom_field_options",
    "custom_field_sections",
    "custom_field_values",
    "custom_fields",
    "exports",
    "failed_import_rows",
    "failed_jobs",
    "imports",
    "job_batches",
    "jobs",
    "media",
    "noteables",
    "notes",
    "notifications",
    "oauth_access_tokens",
    "oauth_auth_codes",
    "oauth_clients",
    "oauth_device_codes",
    "oauth_refresh_tokens",
    "opportunities",
    "password_reset_tokens",
    "pending_actions",
    "people",
    "personal_access_tokens",
    "seo",
    "sessions",
    "subscription_items",
    "subscriptions",
    "system_administrators",
    "task_user",
    "taskables",
    "tasks",
    "team_invitations",
    "team_user",
    "teams",
    "user_social_accounts",
    "users",
] as const;

const exportedTables = Object.values(schema).filter((value) =>
    is(value, PgTable),
);

const findColumn = (table: PgTable, name: string): AnyPgColumn => {
    const column = getTableConfig(table).columns.find(
        (candidate) => candidate.name === name,
    );

    if (column === undefined) {
        throw new Error(`Missing ${getTableConfig(table).name}.${name}`);
    }

    return column;
};

describe("Drizzle database schema", () => {
    it("exports every active application table exactly once", () => {
        const exportedTableNames = exportedTables
            .map((table) => getTableConfig(table).name)
            .sort();

        expect(exportedTableNames).toEqual([...activeTableNames].sort());
        expect(new Set(exportedTableNames).size).toBe(exportedTableNames.length);

        for (const table of exportedTables) {
            const columnNames = getTableConfig(table).columns.map(
                (column) => column.name,
            );

            expect(new Set(columnNames).size).toBe(columnNames.length);
        }
    });

    it("preserves the mixed identifier and PostgreSQL value types", () => {
        expect(findColumn(schema.users, "id").getSQLType()).toBe("char(26)");
        expect(findColumn(schema.personalAccessTokens, "id").getSQLType()).toBe(
            "bigserial",
        );
        expect(findColumn(schema.notifications, "id").getSQLType()).toBe(
            "uuid",
        );
        expect(
            findColumn(schema.opportunities, "order_column").getSQLType(),
        ).toBe("numeric(20, 10)");
        expect(findColumn(schema.customFields, "settings").getSQLType()).toBe(
            "json",
        );
        expect(findColumn(schema.users, "ai_preferences").getSQLType()).toBe(
            "jsonb",
        );
        expect(
            findColumn(schema.agentConversationMessages, "document").getSQLType(),
        ).toBe("jsonb");
    });

    it("maps the final polymorphic chat participant columns", () => {
        const conversationColumns = getTableConfig(
            schema.agentConversations,
        ).columns.map((column) => column.name);
        const messageColumns = getTableConfig(
            schema.agentConversationMessages,
        ).columns.map((column) => column.name);

        expect(conversationColumns).toContain("participant_type");
        expect(conversationColumns).toContain("participant_id");
        expect(conversationColumns).not.toContain("user_id");
        expect(messageColumns).toContain("approval_state");
        expect(messageColumns).toContain("superseded_at");
        expect(messageColumns).not.toContain("user_id");
    });

    it("describes final checks, indexes, and deletion behavior", () => {
        const balanceConfig = getTableConfig(schema.aiCreditBalances);
        const customValueConfig = getTableConfig(schema.customFieldValues);
        const blogPostConfig = getTableConfig(schema.blogPosts);
        const authorForeignKey = blogPostConfig.foreignKeys.find(
            (foreignKey) =>
                foreignKey.getName() === "blog_posts_author_id_foreign",
        );

        expect(balanceConfig.checks.map((check) => check.name).sort()).toEqual([
            "ai_credit_balances_credits_nonneg",
            "ai_credit_balances_credits_used_nonneg",
            "ai_credit_balances_period_order",
            "ai_credit_balances_purchased_lte_remaining",
            "ai_credit_balances_purchased_nonneg",
        ]);
        expect(customValueConfig.indexes.map((index) => index.config.name)).toEqual(
            expect.arrayContaining([
                "custom_field_values_tenant_entity_idx",
                "cfv_field_float_idx",
                "cfv_field_date_idx",
                "cfv_field_datetime_idx",
                "cfv_field_string_idx",
                "cfv_field_integer_idx",
                "cfv_field_boolean_idx",
            ]),
        );
        expect(authorForeignKey?.onDelete).toBe("set null");
        expect(findColumn(schema.blogPosts, "author_id").notNull).toBe(false);
    });
});
