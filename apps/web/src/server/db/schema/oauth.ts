import {
    bigserial,
    boolean,
    char,
    foreignKey,
    index,
    pgTable,
    text,
    timestamp,
    unique,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";

import { teams } from "./core";
import { laravelTimestamps, ulid } from "./shared";

export const personalAccessTokens = pgTable(
    "personal_access_tokens",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        tokenableType: varchar("tokenable_type", { length: 255 }).notNull(),
        tokenableId: ulid("tokenable_id").notNull(),
        teamId: ulid("team_id"),
        name: varchar("name", { length: 255 }).notNull(),
        token: varchar("token", { length: 64 }).notNull(),
        abilities: text("abilities"),
        lastUsedAt: timestamp("last_used_at", { mode: "date" }),
        expiresAt: timestamp("expires_at", { mode: "date" }),
        ...laravelTimestamps(),
    },
    (table) => [
        index("personal_access_tokens_tokenable_type_tokenable_id_index").on(
            table.tokenableType,
            table.tokenableId,
        ),
        unique("personal_access_tokens_token_unique").on(table.token),
        index("personal_access_tokens_team_id_index").on(table.teamId),
        foreignKey({
            name: "personal_access_tokens_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
    ],
);

export const oauthAuthCodes = pgTable(
    "oauth_auth_codes",
    {
        id: char("id", { length: 80 }).primaryKey(),
        userId: ulid("user_id").notNull(),
        clientId: uuid("client_id").notNull(),
        teamId: ulid("team_id"),
        scopes: text("scopes"),
        revoked: boolean("revoked").notNull(),
        expiresAt: timestamp("expires_at", { mode: "date" }),
    },
    (table) => [
        index("oauth_auth_codes_user_id_index").on(table.userId),
        index("oauth_auth_codes_team_id_index").on(table.teamId),
    ],
);

export const oauthAccessTokens = pgTable(
    "oauth_access_tokens",
    {
        id: char("id", { length: 80 }).primaryKey(),
        userId: ulid("user_id"),
        clientId: uuid("client_id").notNull(),
        teamId: ulid("team_id"),
        name: varchar("name", { length: 255 }),
        scopes: text("scopes"),
        revoked: boolean("revoked").notNull(),
        ...laravelTimestamps(),
        expiresAt: timestamp("expires_at", { mode: "date" }),
    },
    (table) => [
        index("oauth_access_tokens_user_id_index").on(table.userId),
        index("oauth_access_tokens_team_id_index").on(table.teamId),
    ],
);

export const oauthRefreshTokens = pgTable(
    "oauth_refresh_tokens",
    {
        id: char("id", { length: 80 }).primaryKey(),
        accessTokenId: char("access_token_id", { length: 80 }).notNull(),
        familyId: char("family_id", { length: 80 }).notNull(),
        revoked: boolean("revoked").notNull(),
        expiresAt: timestamp("expires_at", { mode: "date" }),
    },
    (table) => [
        index("oauth_refresh_tokens_family_id_index").on(table.familyId),
        foreignKey({
            name: "oauth_refresh_tokens_access_token_id_foreign",
            columns: [table.accessTokenId],
            foreignColumns: [oauthAccessTokens.id],
        }).onDelete("cascade"),
    ],
);

export const oauthClients = pgTable(
    "oauth_clients",
    {
        id: uuid("id").primaryKey(),
        ownerType: varchar("owner_type", { length: 255 }),
        ownerId: ulid("owner_id"),
        name: varchar("name", { length: 255 }).notNull(),
        secret: varchar("secret", { length: 255 }),
        provider: varchar("provider", { length: 255 }),
        redirectUris: text("redirect_uris").notNull(),
        grantTypes: text("grant_types").notNull(),
        revoked: boolean("revoked").notNull(),
        ...laravelTimestamps(),
    },
    (table) => [
        index("oauth_clients_owner_type_owner_id_index").on(
            table.ownerType,
            table.ownerId,
        ),
    ],
);

export const oauthDeviceCodes = pgTable(
    "oauth_device_codes",
    {
        id: char("id", { length: 80 }).primaryKey(),
        userId: ulid("user_id"),
        clientId: uuid("client_id").notNull(),
        userCode: char("user_code", { length: 8 }).notNull(),
        scopes: text("scopes").notNull(),
        revoked: boolean("revoked").notNull(),
        userApprovedAt: timestamp("user_approved_at", { mode: "date" }),
        lastPolledAt: timestamp("last_polled_at", { mode: "date" }),
        expiresAt: timestamp("expires_at", { mode: "date" }),
    },
    (table) => [
        index("oauth_device_codes_user_id_index").on(table.userId),
        index("oauth_device_codes_client_id_index").on(table.clientId),
        unique("oauth_device_codes_user_code_unique").on(table.userCode),
    ],
);
