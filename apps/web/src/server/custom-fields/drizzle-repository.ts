import { and, asc, eq, ne, or, sql, type SQL } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import {
    customFieldOptions,
    customFields,
    customFieldValues,
} from "@/server/db/schema";
import type { JsonValue } from "@/server/db/schema/shared";
import { ulidSchema } from "@/server/ids";

import type {
    CustomFieldRepository,
    CustomFieldUniquenessQuery,
} from "./repository";
import type {
    CustomFieldDefinition,
    CustomFieldEntityType,
    CustomFieldOption,
    CustomFieldOptionPromotion,
    CustomFieldValueMutation,
    CustomFieldValueRecord,
} from "./types";
import { customFieldEntityTypes } from "./types";

type Database = ReturnType<typeof getDatabase>;

const toEntityType = (value: string): CustomFieldEntityType => {
    if (!customFieldEntityTypes.includes(value as CustomFieldEntityType)) {
        throw new Error(`Unsupported custom-field entity type in storage: ${value}`);
    }

    return value as CustomFieldEntityType;
};

const toOption = (row: {
    optionId: string | null;
    optionTeamId: string | null;
    optionCustomFieldId: string | null;
    optionName: string | null;
    optionSortOrder: bigint | null;
}): CustomFieldOption | undefined => {
    if (
        row.optionId === null ||
        row.optionTeamId === null ||
        row.optionCustomFieldId === null
    ) {
        return undefined;
    }

    return {
        id: ulidSchema.parse(row.optionId),
        teamId: ulidSchema.parse(row.optionTeamId),
        customFieldId: ulidSchema.parse(row.optionCustomFieldId),
        label: row.optionName ?? "",
        sortOrder: row.optionSortOrder,
    };
};

const toValueRecord = (
    row: typeof customFieldValues.$inferSelect,
): CustomFieldValueRecord => ({
    id: ulidSchema.parse(row.id),
    teamId: ulidSchema.parse(row.tenantId),
    entityType: toEntityType(row.entityType),
    entityId: ulidSchema.parse(row.entityId),
    customFieldId: ulidSchema.parse(row.customFieldId),
    stringValue: row.stringValue,
    textValue: row.textValue,
    booleanValue: row.booleanValue,
    integerValue: row.integerValue,
    floatValue: row.floatValue,
    dateValue: row.dateValue,
    datetimeValue: row.datetimeValue,
    jsonValue: Array.isArray(row.jsonValue)
        ? (row.jsonValue as JsonValue[])
        : null,
});

const conflictCondition = (
    query: CustomFieldUniquenessQuery,
): SQL | undefined => {
    const values = query.values;

    if (values.jsonValue !== null && values.jsonValue.length > 0) {
        return or(
            ...values.jsonValue.map(
                (value) =>
                    sql`${customFieldValues.jsonValue}::jsonb @> ${JSON.stringify([value])}::jsonb`,
            ),
        );
    }

    if (values.stringValue !== null && values.stringValue !== "") {
        return eq(customFieldValues.stringValue, values.stringValue);
    }

    if (values.textValue !== null && values.textValue !== "") {
        return eq(customFieldValues.textValue, values.textValue);
    }

    if (values.booleanValue !== null) {
        return eq(customFieldValues.booleanValue, values.booleanValue);
    }

    if (values.integerValue !== null) {
        return eq(customFieldValues.integerValue, values.integerValue);
    }

    if (values.floatValue !== null) {
        return eq(customFieldValues.floatValue, values.floatValue);
    }

    if (values.dateValue !== null) {
        return eq(customFieldValues.dateValue, values.dateValue);
    }

    if (values.datetimeValue !== null) {
        return eq(customFieldValues.datetimeValue, values.datetimeValue);
    }

    return undefined;
};

export class DrizzleCustomFieldRepository implements CustomFieldRepository {
    public constructor(private readonly database: Database = getDatabase()) {}

    public async loadActiveDefinitions(
        teamId: Parameters<CustomFieldRepository["loadActiveDefinitions"]>[0],
        entityType: CustomFieldEntityType,
    ): Promise<readonly CustomFieldDefinition[]> {
        const rows = await this.database
            .select({
                id: customFields.id,
                teamId: customFields.tenantId,
                entityType: customFields.entityType,
                code: customFields.code,
                name: customFields.name,
                type: customFields.type,
                lookupType: customFields.lookupType,
                validationRules: customFields.validationRules,
                settings: customFields.settings,
                optionId: customFieldOptions.id,
                optionTeamId: customFieldOptions.tenantId,
                optionCustomFieldId: customFieldOptions.customFieldId,
                optionName: customFieldOptions.name,
                optionSortOrder: customFieldOptions.sortOrder,
            })
            .from(customFields)
            .leftJoin(
                customFieldOptions,
                and(
                    eq(customFieldOptions.customFieldId, customFields.id),
                    eq(customFieldOptions.tenantId, teamId),
                ),
            )
            .where(
                and(
                    eq(customFields.tenantId, teamId),
                    eq(customFields.entityType, entityType),
                    eq(customFields.active, true),
                ),
            )
            .orderBy(
                asc(customFields.sortOrder),
                asc(customFields.code),
                asc(customFieldOptions.sortOrder),
            );
        const byId = new Map<string, CustomFieldDefinition>();

        for (const row of rows) {
            if (row.teamId === null) {
                continue;
            }

            const id = ulidSchema.parse(row.id);
            const existing = byId.get(id);
            const option = toOption(row);

            if (existing !== undefined) {
                if (option !== undefined) {
                    byId.set(id, {
                        ...existing,
                        options: [...existing.options, option],
                    });
                }

                continue;
            }

            byId.set(id, {
                id,
                teamId: ulidSchema.parse(row.teamId),
                entityType: toEntityType(row.entityType),
                code: row.code,
                name: row.name,
                type: row.type,
                lookupType: row.lookupType,
                validationRules: row.validationRules,
                settings: row.settings,
                options: option === undefined ? [] : [option],
            });
        }

        return [...byId.values()];
    }

    public async loadValues(
        teamId: Parameters<CustomFieldRepository["loadValues"]>[0],
        entityType: CustomFieldEntityType,
        entityId: Parameters<CustomFieldRepository["loadValues"]>[2],
    ): Promise<readonly CustomFieldValueRecord[]> {
        const rows = await this.database
            .select()
            .from(customFieldValues)
            .where(
                and(
                    eq(customFieldValues.tenantId, teamId),
                    eq(customFieldValues.entityType, entityType),
                    eq(customFieldValues.entityId, entityId),
                ),
            );

        return rows.map(toValueRecord);
    }

    public async hasConflictingValue(
        query: CustomFieldUniquenessQuery,
    ): Promise<boolean> {
        const valueCondition = conflictCondition(query);

        if (valueCondition === undefined) {
            return false;
        }

        const [conflict] = await this.database
            .select({ id: customFieldValues.id })
            .from(customFieldValues)
            .where(
                and(
                    eq(customFieldValues.tenantId, query.teamId),
                    eq(customFieldValues.entityType, query.entityType),
                    eq(customFieldValues.customFieldId, query.customFieldId),
                    ne(customFieldValues.entityId, query.entityId),
                    valueCondition,
                ),
            )
            .limit(1);

        return conflict !== undefined;
    }

    public async persistValues(
        mutations: readonly CustomFieldValueMutation[],
        optionPromotions: readonly CustomFieldOptionPromotion[],
    ): Promise<void> {
        if (mutations.length === 0 && optionPromotions.length === 0) {
            return;
        }

        await this.database.transaction(async (transaction) => {
            if (optionPromotions.length > 0) {
                await transaction
                    .insert(customFieldOptions)
                    .values(
                        optionPromotions.map((option) => ({
                            id: option.id,
                            tenantId: option.teamId,
                            customFieldId: option.customFieldId,
                            name: option.label,
                            sortOrder: option.sortOrder,
                            settings: null,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        })),
                    )
                    .onConflictDoNothing({
                        target: [
                            customFieldOptions.customFieldId,
                            customFieldOptions.name,
                            customFieldOptions.tenantId,
                        ],
                    });
            }

            if (mutations.length === 0) {
                return;
            }

            await transaction
                .insert(customFieldValues)
                .values(
                    mutations.map((mutation) => ({
                        id: mutation.id,
                        tenantId: mutation.teamId,
                        entityType: mutation.entityType,
                        entityId: mutation.entityId,
                        customFieldId: mutation.customFieldId,
                        stringValue: mutation.stringValue,
                        textValue: mutation.textValue,
                        booleanValue: mutation.booleanValue,
                        integerValue: mutation.integerValue,
                        floatValue: mutation.floatValue,
                        dateValue: mutation.dateValue,
                        datetimeValue: mutation.datetimeValue,
                        jsonValue:
                            mutation.jsonValue === null
                                ? null
                                : [...mutation.jsonValue],
                    })),
                )
                .onConflictDoUpdate({
                    target: [
                        customFieldValues.entityType,
                        customFieldValues.entityId,
                        customFieldValues.customFieldId,
                        customFieldValues.tenantId,
                    ],
                    set: {
                        stringValue: sql`excluded."string_value"`,
                        textValue: sql`excluded."text_value"`,
                        booleanValue: sql`excluded."boolean_value"`,
                        integerValue: sql`excluded."integer_value"`,
                        floatValue: sql`excluded."float_value"`,
                        dateValue: sql`excluded."date_value"`,
                        datetimeValue: sql`excluded."datetime_value"`,
                        jsonValue: sql`excluded."json_value"`,
                    },
                });
        });
    }
}
