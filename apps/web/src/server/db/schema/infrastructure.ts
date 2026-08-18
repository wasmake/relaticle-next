import {
    bigserial,
    index,
    integer,
    pgTable,
    smallint,
    text,
    timestamp,
    unique,
    varchar,
} from "drizzle-orm/pg-core";

import { ulid } from "./shared";

export const passwordResetTokens = pgTable("password_reset_tokens", {
    email: varchar("email", { length: 255 }).primaryKey(),
    token: varchar("token", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }),
});

export const sessions = pgTable(
    "sessions",
    {
        id: varchar("id", { length: 255 }).primaryKey(),
        userId: ulid("user_id"),
        ipAddress: varchar("ip_address", { length: 45 }),
        userAgent: text("user_agent"),
        payload: text("payload").notNull(),
        lastActivity: integer("last_activity").notNull(),
    },
    (table) => [
        index("sessions_user_id_index").on(table.userId),
        index("sessions_last_activity_index").on(table.lastActivity),
    ],
);

export const cache = pgTable("cache", {
    key: varchar("key", { length: 255 }).primaryKey(),
    value: text("value").notNull(),
    expiration: integer("expiration").notNull(),
});

export const cacheLocks = pgTable("cache_locks", {
    key: varchar("key", { length: 255 }).primaryKey(),
    owner: varchar("owner", { length: 255 }).notNull(),
    expiration: integer("expiration").notNull(),
});

export const jobs = pgTable(
    "jobs",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        queue: varchar("queue", { length: 255 }).notNull(),
        payload: text("payload").notNull(),
        attempts: smallint("attempts").notNull(),
        reservedAt: integer("reserved_at"),
        availableAt: integer("available_at").notNull(),
        createdAt: integer("created_at").notNull(),
    },
    (table) => [index("jobs_queue_index").on(table.queue)],
);

export const jobBatches = pgTable("job_batches", {
    id: varchar("id", { length: 255 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    totalJobs: integer("total_jobs").notNull(),
    pendingJobs: integer("pending_jobs").notNull(),
    failedJobs: integer("failed_jobs").notNull(),
    failedJobIds: text("failed_job_ids").notNull(),
    options: text("options"),
    cancelledAt: integer("cancelled_at"),
    createdAt: integer("created_at").notNull(),
    finishedAt: integer("finished_at"),
});

export const failedJobs = pgTable(
    "failed_jobs",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        uuid: varchar("uuid", { length: 255 }).notNull(),
        connection: text("connection").notNull(),
        queue: text("queue").notNull(),
        payload: text("payload").notNull(),
        exception: text("exception").notNull(),
        failedAt: timestamp("failed_at", { mode: "date" })
            .defaultNow()
            .notNull(),
    },
    (table) => [unique("failed_jobs_uuid_unique").on(table.uuid)],
);
