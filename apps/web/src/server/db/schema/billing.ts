import {
    bigint,
    bigserial,
    foreignKey,
    index,
    integer,
    pgTable,
    timestamp,
    unique,
    varchar,
} from "drizzle-orm/pg-core";

import { teams } from "./core";
import { laravelTimestamps, ulid } from "./shared";

export const subscriptions = pgTable(
    "subscriptions",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        teamId: ulid("team_id").notNull(),
        type: varchar("type", { length: 255 }).notNull(),
        stripeId: varchar("stripe_id", { length: 255 }).notNull(),
        stripeStatus: varchar("stripe_status", { length: 255 }).notNull(),
        stripePrice: varchar("stripe_price", { length: 255 }),
        quantity: integer("quantity"),
        trialEndsAt: timestamp("trial_ends_at", { mode: "date" }),
        endsAt: timestamp("ends_at", { mode: "date" }),
        stripeEventCreatedAt: timestamp("stripe_event_created_at", { mode: "date" }),
        stripeEventId: varchar("stripe_event_id", { length: 255 }),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "subscriptions_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        unique("subscriptions_stripe_id_unique").on(table.stripeId),
        index("subscriptions_team_id_stripe_status_index").on(
            table.teamId,
            table.stripeStatus,
        ),
    ],
);

export const subscriptionItems = pgTable(
    "subscription_items",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        subscriptionId: bigint("subscription_id", {
            mode: "bigint",
        }).notNull(),
        stripeId: varchar("stripe_id", { length: 255 }).notNull(),
        stripeProduct: varchar("stripe_product", { length: 255 }).notNull(),
        stripePrice: varchar("stripe_price", { length: 255 }).notNull(),
        quantity: integer("quantity"),
        meterId: varchar("meter_id", { length: 255 }),
        meterEventName: varchar("meter_event_name", { length: 255 }),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "subscription_items_subscription_id_foreign",
            columns: [table.subscriptionId],
            foreignColumns: [subscriptions.id],
        }).onDelete("cascade"),
        unique("subscription_items_stripe_id_unique").on(table.stripeId),
        index("subscription_items_subscription_id_stripe_price_index").on(
            table.subscriptionId,
            table.stripePrice,
        ),
    ],
);
