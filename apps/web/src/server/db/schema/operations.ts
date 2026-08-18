import {
    bigint,
    bigserial,
    foreignKey,
    index,
    integer,
    json,
    pgTable,
    text,
    timestamp,
    unique,
    uuid,
    varchar,
} from "drizzle-orm/pg-core";

import { teams, users } from "./core";
import type { JsonValue } from "./shared";
import { laravelTimestamps, ulid } from "./shared";

export const imports = pgTable(
    "imports",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id"),
        completedAt: timestamp("completed_at", { mode: "date" }),
        fileName: varchar("file_name", { length: 255 }).notNull(),
        totalRows: integer("total_rows").notNull(),
        userId: ulid("user_id").notNull(),
        entityType: varchar("entity_type", { length: 255 }),
        status: varchar("status", { length: 255 })
            .default("uploading")
            .notNull(),
        headers: json("headers").$type<JsonValue>(),
        columnMappings: json("column_mappings").$type<JsonValue>(),
        createdRows: integer("created_rows").default(0).notNull(),
        updatedRows: integer("updated_rows").default(0).notNull(),
        skippedRows: integer("skipped_rows").default(0).notNull(),
        failedRows: integer("failed_rows").default(0).notNull(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "imports_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "imports_user_id_foreign",
            columns: [table.userId],
            foreignColumns: [users.id],
        }).onDelete("cascade"),
    ],
);

export const exports = pgTable(
    "exports",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id"),
        completedAt: timestamp("completed_at", { mode: "date" }),
        fileDisk: varchar("file_disk", { length: 255 }).notNull(),
        fileName: varchar("file_name", { length: 255 }),
        exporter: varchar("exporter", { length: 255 }).notNull(),
        processedRows: integer("processed_rows").default(0).notNull(),
        totalRows: integer("total_rows").notNull(),
        successfulRows: integer("successful_rows").default(0).notNull(),
        userId: ulid("user_id").notNull(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "exports_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "exports_user_id_foreign",
            columns: [table.userId],
            foreignColumns: [users.id],
        }).onDelete("cascade"),
    ],
);

export const failedImportRows = pgTable(
    "failed_import_rows",
    {
        id: ulid("id").primaryKey(),
        teamId: ulid("team_id"),
        data: json("data").$type<JsonValue>().notNull(),
        importId: ulid("import_id").notNull(),
        validationError: text("validation_error"),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "failed_import_rows_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "failed_import_rows_import_id_foreign",
            columns: [table.importId],
            foreignColumns: [imports.id],
        }).onDelete("cascade"),
    ],
);

export const media = pgTable(
    "media",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        modelType: varchar("model_type", { length: 255 }).notNull(),
        modelId: ulid("model_id").notNull(),
        uuid: uuid("uuid"),
        collectionName: varchar("collection_name", { length: 255 }).notNull(),
        name: varchar("name", { length: 255 }).notNull(),
        fileName: varchar("file_name", { length: 255 }).notNull(),
        mimeType: varchar("mime_type", { length: 255 }),
        disk: varchar("disk", { length: 255 }).notNull(),
        conversionsDisk: varchar("conversions_disk", { length: 255 }),
        size: bigint("size", { mode: "bigint" }).notNull(),
        manipulations: json("manipulations").$type<JsonValue>().notNull(),
        customProperties:
            json("custom_properties").$type<JsonValue>().notNull(),
        generatedConversions:
            json("generated_conversions").$type<JsonValue>().notNull(),
        responsiveImages:
            json("responsive_images").$type<JsonValue>().notNull(),
        orderColumn: integer("order_column"),
        ...laravelTimestamps(),
    },
    (table) => [
        index("media_model_type_model_id_index").on(
            table.modelType,
            table.modelId,
        ),
        unique("media_uuid_unique").on(table.uuid),
        index("media_order_column_index").on(table.orderColumn),
    ],
);

export const notifications = pgTable(
    "notifications",
    {
        id: uuid("id").primaryKey(),
        type: varchar("type", { length: 255 }).notNull(),
        notifiableType: varchar("notifiable_type", { length: 255 }).notNull(),
        notifiableId: ulid("notifiable_id").notNull(),
        data: json("data").$type<JsonValue>().notNull(),
        readAt: timestamp("read_at", { mode: "date" }),
        ...laravelTimestamps(),
    },
    (table) => [
        index("notifications_notifiable_type_notifiable_id_index").on(
            table.notifiableType,
            table.notifiableId,
        ),
    ],
);

export const activityLog = pgTable(
    "activity_log",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        teamId: ulid("team_id"),
        logName: varchar("log_name", { length: 255 }),
        description: text("description").notNull(),
        subjectType: varchar("subject_type", { length: 255 }),
        subjectId: ulid("subject_id"),
        event: varchar("event", { length: 255 }),
        causerType: varchar("causer_type", { length: 255 }),
        causerId: ulid("causer_id"),
        attributeChanges: json("attribute_changes").$type<JsonValue>(),
        properties: json("properties").$type<JsonValue>(),
        ...laravelTimestamps(),
        batchUuid: uuid("batch_uuid"),
    },
    (table) => [
        foreignKey({
            name: "activity_log_team_id_foreign",
            columns: [table.teamId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        index("activity_log_log_name_index").on(table.logName),
        index("subject").on(table.subjectType, table.subjectId),
        index("causer").on(table.causerType, table.causerId),
        index("idx_activity_log_subject_timeline").on(
            table.subjectType,
            table.subjectId,
            table.createdAt,
        ),
        index("idx_activity_log_team_activity").on(
            table.teamId,
            table.createdAt,
        ),
        index("activity_log_batch_uuid_index").on(table.batchUuid),
    ],
);

export const seo = pgTable(
    "seo",
    {
        id: bigserial("id", { mode: "bigint" }).primaryKey(),
        modelType: varchar("model_type", { length: 255 }).notNull(),
        modelId: bigint("model_id", { mode: "bigint" }).notNull(),
        description: text("description"),
        title: varchar("title", { length: 255 }),
        image: varchar("image", { length: 255 }),
        author: varchar("author", { length: 255 }),
        robots: varchar("robots", { length: 255 }),
        canonicalUrl: varchar("canonical_url", { length: 255 }),
        ...laravelTimestamps(),
    },
    (table) => [
        index("seo_model_type_model_id_index").on(
            table.modelType,
            table.modelId,
        ),
        unique("seo_model_type_model_id_unique").on(
            table.modelType,
            table.modelId,
        ),
    ],
);
