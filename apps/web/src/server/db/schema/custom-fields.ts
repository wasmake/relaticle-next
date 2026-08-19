import { sql } from "drizzle-orm";
import {
    bigint,
    boolean,
    date,
    doublePrecision,
    foreignKey,
    index,
    json,
    pgTable,
    text,
    timestamp,
    unique,
    uniqueIndex,
    varchar,
} from "drizzle-orm/pg-core";

import { teams } from "./core";
import type { JsonValue } from "./shared";
import { laravelTimestamps, ulid } from "./shared";

export const customFieldSections = pgTable(
    "custom_field_sections",
    {
        id: ulid("id").primaryKey(),
        tenantId: ulid("tenant_id"),
        width: varchar("width", { length: 255 }),
        code: varchar("code", { length: 255 }).notNull(),
        name: varchar("name", { length: 255 }).notNull(),
        type: varchar("type", { length: 255 }).notNull(),
        entityType: varchar("entity_type", { length: 255 }).notNull(),
        sortOrder: bigint("sort_order", { mode: "bigint" }),
        description: varchar("description", { length: 255 }),
        active: boolean("active").default(true).notNull(),
        systemDefined: boolean("system_defined").default(false).notNull(),
        settings: json("settings").$type<JsonValue>(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "custom_field_sections_tenant_id_foreign",
            columns: [table.tenantId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        index("custom_field_sections_tenant_id_index").on(table.tenantId),
        unique("custom_field_sections_entity_type_code_tenant_id_unique").on(
            table.entityType,
            table.code,
            table.tenantId,
        ),
        index("custom_field_sections_tenant_entity_active_idx").on(
            table.tenantId,
            table.entityType,
            table.active,
        ),
    ],
);

export const customFields = pgTable(
    "custom_fields",
    {
        id: ulid("id").primaryKey(),
        customFieldSectionId: ulid("custom_field_section_id"),
        width: varchar("width", { length: 255 }),
        tenantId: ulid("tenant_id"),
        code: varchar("code", { length: 255 }).notNull(),
        name: varchar("name", { length: 255 }).notNull(),
        type: varchar("type", { length: 255 }).notNull(),
        lookupType: varchar("lookup_type", { length: 255 }),
        entityType: varchar("entity_type", { length: 255 }).notNull(),
        sortOrder: bigint("sort_order", { mode: "bigint" }),
        validationRules: json("validation_rules").$type<JsonValue>(),
        active: boolean("active").default(true).notNull(),
        systemDefined: boolean("system_defined").default(false).notNull(),
        settings: json("settings").$type<JsonValue>(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "custom_fields_custom_field_section_id_foreign",
            columns: [table.customFieldSectionId],
            foreignColumns: [customFieldSections.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "custom_fields_tenant_id_foreign",
            columns: [table.tenantId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        index("custom_fields_tenant_id_index").on(table.tenantId),
        unique("custom_fields_code_entity_type_tenant_id_unique").on(
            table.code,
            table.entityType,
            table.tenantId,
        ),
        uniqueIndex("custom_fields_global_code_entity_type_unique")
            .on(table.code, table.entityType)
            .where(sql`${table.tenantId} is null`),
        index("custom_fields_tenant_entity_active_idx").on(
            table.tenantId,
            table.entityType,
            table.active,
        ),
    ],
);

export const customFieldOptions = pgTable(
    "custom_field_options",
    {
        id: ulid("id").primaryKey(),
        tenantId: ulid("tenant_id"),
        customFieldId: ulid("custom_field_id").notNull(),
        name: varchar("name", { length: 255 }),
        sortOrder: bigint("sort_order", { mode: "bigint" }),
        settings: json("settings").$type<JsonValue>(),
        ...laravelTimestamps(),
    },
    (table) => [
        foreignKey({
            name: "custom_field_options_tenant_id_foreign",
            columns: [table.tenantId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "custom_field_options_custom_field_id_foreign",
            columns: [table.customFieldId],
            foreignColumns: [customFields.id],
        }).onDelete("cascade"),
        index("custom_field_options_tenant_id_index").on(table.tenantId),
        unique(
            "custom_field_options_custom_field_id_name_tenant_id_unique",
        ).on(table.customFieldId, table.name, table.tenantId),
    ],
);

export const customFieldValues = pgTable(
    "custom_field_values",
    {
        id: ulid("id").primaryKey(),
        tenantId: ulid("tenant_id"),
        entityType: varchar("entity_type", { length: 255 }).notNull(),
        entityId: ulid("entity_id").notNull(),
        customFieldId: ulid("custom_field_id").notNull(),
        stringValue: text("string_value"),
        textValue: text("text_value"),
        booleanValue: boolean("boolean_value"),
        integerValue: bigint("integer_value", { mode: "bigint" }),
        floatValue: doublePrecision("float_value"),
        dateValue: date("date_value", { mode: "string" }),
        datetimeValue: timestamp("datetime_value", { mode: "date" }),
        jsonValue: json("json_value").$type<JsonValue>(),
    },
    (table) => [
        foreignKey({
            name: "custom_field_values_tenant_id_foreign",
            columns: [table.tenantId],
            foreignColumns: [teams.id],
        }).onDelete("cascade"),
        foreignKey({
            name: "custom_field_values_custom_field_id_foreign",
            columns: [table.customFieldId],
            foreignColumns: [customFields.id],
        }).onDelete("cascade"),
        index("custom_field_values_tenant_id_index").on(table.tenantId),
        index("custom_field_values_entity_type_entity_id_index").on(
            table.entityType,
            table.entityId,
        ),
        unique("custom_field_values_entity_type_unique").on(
            table.entityType,
            table.entityId,
            table.customFieldId,
            table.tenantId,
        ),
        index("custom_field_values_tenant_entity_idx").on(
            table.tenantId,
            table.entityType,
            table.entityId,
        ),
        index("custom_field_values_entity_id_custom_field_id_index").on(
            table.entityId,
            table.customFieldId,
        ),
        index("cfv_field_float_idx").on(
            table.customFieldId,
            table.floatValue,
        ),
        index("cfv_field_date_idx").on(
            table.customFieldId,
            table.dateValue,
        ),
        index("cfv_field_datetime_idx").on(
            table.customFieldId,
            table.datetimeValue,
        ),
        index("cfv_field_string_idx").on(
            table.customFieldId,
            table.stringValue,
        ),
        index("cfv_field_integer_idx").on(
            table.customFieldId,
            table.integerValue,
        ),
        index("cfv_field_boolean_idx").on(
            table.customFieldId,
            table.booleanValue,
        ),
    ],
);
