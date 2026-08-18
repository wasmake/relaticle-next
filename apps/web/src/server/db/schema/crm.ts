import {
    bigserial,
    foreignKey,
    index,
    numeric,
    pgTable,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";

import { teams, users } from "./core";
import { laravelTimestamps, ulid } from "./shared";

export const companies = pgTable(
    "companies",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id").notNull(),
        creatorId: ulid("creator_id"),
        accountOwnerId: ulid("account_owner_id"),
        name: varchar("name", { length: 255 }).notNull(),
        creationSource: varchar("creation_source", { length: 50 }).notNull(),
        ...laravelTimestamps(),
        deletedAt: timestamp("deleted_at", { mode: "date" }),
    },
    (table) => [
        foreignKey({
            name: "companies_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "companies_creator_id_foreign",
            columns: [table.creatorId],
            foreignColumns: [users.id],
        }).onDelete("set null"),
        foreignKey({
            name: "companies_account_owner_id_foreign",
            columns: [table.accountOwnerId],
            foreignColumns: [users.id],
        }).onDelete("set null"),
        index("idx_companies_team_activity").on(
            table.teamId,
            table.deletedAt,
            table.creationSource,
            table.createdAt,
        ),
    ],
);

export const people = pgTable(
    "people",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id").notNull(),
        creatorId: ulid("creator_id"),
        companyId: ulid("company_id"),
        name: varchar("name", { length: 255 }).notNull(),
        creationSource: varchar("creation_source", { length: 50 }).notNull(),
        ...laravelTimestamps(),
        deletedAt: timestamp("deleted_at", { mode: "date" }),
    },
    (table) => [
        foreignKey({
            name: "people_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "people_creator_id_foreign",
            columns: [table.creatorId],
            foreignColumns: [users.id],
        }).onDelete("set null"),
        foreignKey({
            name: "people_company_id_foreign",
            columns: [table.companyId],
            foreignColumns: [companies.id],
        }).onDelete("set null"),
        index("idx_people_team_activity").on(
            table.teamId,
            table.deletedAt,
            table.creationSource,
            table.createdAt,
        ),
    ],
);

export const opportunities = pgTable(
    "opportunities",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id").notNull(),
        creatorId: ulid("creator_id"),
        companyId: ulid("company_id"),
        contactId: ulid("contact_id"),
        name: varchar("name", { length: 255 }).notNull(),
        creationSource: varchar("creation_source", { length: 50 }).notNull(),
        orderColumn: numeric("order_column", {
            precision: 20,
            scale: 10,
        }),
        ...laravelTimestamps(),
        deletedAt: timestamp("deleted_at", { mode: "date" }),
    },
    (table) => [
        foreignKey({
            name: "opportunities_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "opportunities_creator_id_foreign",
            columns: [table.creatorId],
            foreignColumns: [users.id],
        }).onDelete("set null"),
        foreignKey({
            name: "opportunities_company_id_foreign",
            columns: [table.companyId],
            foreignColumns: [companies.id],
        }).onDelete("set null"),
        foreignKey({
            name: "opportunities_contact_id_foreign",
            columns: [table.contactId],
            foreignColumns: [people.id],
        }).onDelete("set null"),
        index("idx_opportunities_team_activity").on(
            table.teamId,
            table.deletedAt,
            table.creationSource,
            table.createdAt,
        ),
    ],
);

export const tasks = pgTable(
    "tasks",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id").notNull(),
        creatorId: ulid("creator_id"),
        title: varchar("title", { length: 255 }).notNull(),
        creationSource: varchar("creation_source", { length: 50 }).notNull(),
        orderColumn: numeric("order_column", {
            precision: 20,
            scale: 10,
        }),
        ...laravelTimestamps(),
        deletedAt: timestamp("deleted_at", { mode: "date" }),
    },
    (table) => [
        foreignKey({
            name: "tasks_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "tasks_creator_id_foreign",
            columns: [table.creatorId],
            foreignColumns: [users.id],
        }).onDelete("set null"),
        index("idx_tasks_team_activity").on(
            table.teamId,
            table.deletedAt,
            table.creationSource,
            table.createdAt,
        ),
    ],
);

export const notes = pgTable(
    "notes",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id").notNull(),
        creatorId: ulid("creator_id"),
        title: varchar("title", { length: 255 }).notNull(),
        creationSource: varchar("creation_source", { length: 50 }).notNull(),
        ...laravelTimestamps(),
        deletedAt: timestamp("deleted_at", { mode: "date" }),
    },
    (table) => [
        foreignKey({
            name: "notes_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "notes_creator_id_foreign",
            columns: [table.creatorId],
            foreignColumns: [users.id],
        }).onDelete("set null"),
        index("idx_notes_team_activity").on(
            table.teamId,
            table.deletedAt,
            table.creationSource,
            table.createdAt,
        ),
    ],
);

export const taskUser = pgTable(
    "task_user",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        taskId: ulid("task_id").notNull(),
        userId: ulid("user_id").notNull(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "task_user_task_id_foreign",
            columns: [table.taskId],
            foreignColumns: [tasks.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "task_user_user_id_foreign",
            columns: [table.userId],
            foreignColumns: [users.id],
        }).onDelete("cascade"),
        index("task_user_user_id_task_id_idx").on(
            table.userId,
            table.taskId,
        ),
        index("task_user_task_id_idx").on(table.taskId),
    ],
);

export const taskables = pgTable(
    "taskables",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        taskId: ulid("task_id").notNull(),
        taskableType: varchar("taskable_type", { length: 255 }).notNull(),
        taskableId: ulid("taskable_id").notNull(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "taskables_task_id_foreign",
            columns: [table.taskId],
            foreignColumns: [tasks.id],
        }).onDelete("cascade"),
        index("taskables_taskable_type_taskable_id_index").on(
            table.taskableType,
            table.taskableId,
        ),
    ],
);

export const noteables = pgTable(
    "noteables",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        noteId: ulid("note_id").notNull(),
        noteableType: varchar("noteable_type", { length: 255 }).notNull(),
        noteableId: ulid("noteable_id").notNull(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "noteables_note_id_foreign",
            columns: [table.noteId],
            foreignColumns: [notes.id],
        }).onDelete("cascade"),
        index("noteables_noteable_type_noteable_id_index").on(
            table.noteableType,
            table.noteableId,
        ),
    ],
);
