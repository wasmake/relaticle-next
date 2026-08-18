import { sql } from "drizzle-orm";
import {
    type AnyPgColumn,
    bigserial,
    boolean,
    foreignKey,
    index,
    jsonb,
    pgTable,
    text,
    timestamp,
    unique,
    varchar,
} from "drizzle-orm/pg-core";

import type { JsonValue } from "./shared";
import { laravelTimestamps, ulid } from "./shared";

export const users = pgTable(
    "users",
    {
        id: ulid("id").primaryKey(),
        name: varchar("name", { length: 255 }).notNull(),
        email: varchar("email", { length: 255 }).notNull(),
        emailVerifiedAt: timestamp("email_verified_at", { mode: "date" }),
        lastLoginAt: timestamp("last_login_at", { mode: "date" }),
        password: varchar("password", { length: 255 }),
        twoFactorSecret: text("two_factor_secret"),
        twoFactorRecoveryCodes: text("two_factor_recovery_codes"),
        twoFactorConfirmedAt: timestamp("two_factor_confirmed_at", {
            mode: "date",
        }),
        rememberToken: varchar("remember_token", { length: 100 }),
        scheduledDeletionAt: timestamp("scheduled_deletion_at", {
            mode: "date",
        }),
        mailcoachSubscriberUuid: varchar("mailcoach_subscriber_uuid", {
            length: 255,
        }),
        subscriberRecencyBucket: varchar("subscriber_recency_bucket", {
            length: 255,
        }),
        currentTeamId: ulid("current_team_id").references(
            (): AnyPgColumn => teams.id,
            { onDelete: "set null" },
        ),
        profilePhotoPath: varchar("profile_photo_path", { length: 2048 }),
        timezone: varchar("timezone", { length: 64 }),
        notificationPreferences:
            jsonb("notification_preferences").$type<JsonValue>(),
        aiPreferences: jsonb("ai_preferences").$type<JsonValue>(),
        ...laravelTimestamps(),
    },
    (table) => [
        unique("users_email_unique").on(table.email),
        index("users_mailcoach_subscriber_uuid_index").on(
            table.mailcoachSubscriberUuid,
        ),
        index("users_scheduled_deletion_at_index").on(
            table.scheduledDeletionAt,
        ),
        index("users_timezone_index").on(table.timezone),
    ],
);

export const teams = pgTable(
    "teams",
    {
        id: ulid("id").primaryKey(),
        userId: ulid("user_id")
            .notNull()
            .references((): AnyPgColumn => users.id, {
                onDelete: "cascade",
            }),
        name: varchar("name", { length: 255 }).notNull(),
        slug: varchar("slug", { length: 255 }).notNull(),
        inviteLinkToken: varchar("invite_link_token", { length: 40 }),
        inviteLinkTokenExpiresAt: timestamp("invite_link_token_expires_at", {
            mode: "date",
        }),
        personalTeam: boolean("personal_team").notNull(),
        scheduledDeletionAt: timestamp("scheduled_deletion_at", {
            mode: "date",
        }),
        onboardingUseCase: varchar("onboarding_use_case", { length: 255 }),
        onboardingContext: jsonb("onboarding_context").$type<JsonValue>(),
        onboardingReferralSource: varchar("onboarding_referral_source", {
            length: 255,
        }),
        plan: varchar("plan", { length: 32 }).default("free").notNull(),
        stripeId: varchar("stripe_id", { length: 255 }),
        pmType: varchar("pm_type", { length: 255 }),
        pmLastFour: varchar("pm_last_four", { length: 4 }),
        trialEndsAt: timestamp("trial_ends_at", { mode: "date" }),
        hostedFreeGrandfatheredAt: timestamp("hosted_free_grandfathered_at", {
            mode: "date",
        }),
        proTrialUsedAt: timestamp("pro_trial_used_at", { mode: "date" }),
        ...laravelTimestamps(),
    },
    (table) => [
        index("teams_user_id_index").on(table.userId),
        unique("teams_slug_unique").on(table.slug),
        unique("teams_invite_link_token_unique").on(table.inviteLinkToken),
        index("teams_scheduled_deletion_at_index").on(
            table.scheduledDeletionAt,
        ),
        index("teams_stripe_id_index").on(table.stripeId),
        index("teams_trial_ends_at_index")
            .on(table.trialEndsAt)
            .where(sql`${table.trialEndsAt} is not null`),
    ],
);

export const teamUser = pgTable(
    "team_user",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        teamId: ulid("team_id").notNull(),
        userId: ulid("user_id").notNull(),
        role: varchar("role", { length: 255 }),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "team_user_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "team_user_user_id_foreign",
            columns: [table.userId],
            foreignColumns: [users.id],
        }).onDelete("cascade"),
        unique("team_user_team_id_user_id_unique").on(
            table.teamId,
            table.userId,
        ),
    ],
);

export const teamInvitations = pgTable(
    "team_invitations",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id").notNull(),
        email: varchar("email", { length: 255 }).notNull(),
        role: varchar("role", { length: 255 }),
        expiresAt: timestamp("expires_at", { mode: "date" }),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "team_invitations_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        unique("team_invitations_team_id_email_unique").on(
            table.teamId,
            table.email,
        ),
        index("team_invitations_expires_at_index").on(table.expiresAt),
    ],
);

export const userSocialAccounts = pgTable(
    "user_social_accounts",
    {
        id: ulid("id").primaryKey(),
        userId: ulid("user_id").notNull(),
        providerName: varchar("provider_name", { length: 255 }),
        providerId: varchar("provider_id", { length: 255 }),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "user_social_accounts_user_id_foreign",
            columns: [table.userId],
            foreignColumns: [users.id],
        })
            .onUpdate("cascade")
            .onDelete("cascade"),
        unique("user_social_accounts_provider_name_provider_id_unique").on(
            table.providerName,
            table.providerId,
        ),
    ],
);

export const systemAdministrators = pgTable(
    "system_administrators",
    {
        id: ulid("id").primaryKey(),
        name: varchar("name", { length: 255 }).notNull(),
        email: varchar("email", { length: 255 }).notNull(),
        emailVerifiedAt: timestamp("email_verified_at", { mode: "date" }),
        password: varchar("password", { length: 255 }).notNull(),
        role: varchar("role", { length: 255 }).notNull(),
        rememberToken: varchar("remember_token", { length: 100 }),
        ...laravelTimestamps(),
    },
    (table) => [
        unique("system_administrators_email_unique").on(table.email),
        index("system_administrators_email_index").on(table.email),
    ],
);
