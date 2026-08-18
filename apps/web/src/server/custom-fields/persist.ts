import { sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import {
    customFieldOptions,
    customFieldValues,
} from "@/server/db/schema";

import type { PreparedCustomFieldWrite } from "./types";

type Database = ReturnType<typeof getDatabase>;
export type DatabaseTransaction = Parameters<
    Parameters<Database["transaction"]>[0]
>[0];

export const persistPreparedCustomFields = async (
    transaction: DatabaseTransaction,
    prepared: PreparedCustomFieldWrite,
    occurredAt: Date,
): Promise<void> => {
    if (prepared.optionPromotions.length > 0) {
        await transaction
            .insert(customFieldOptions)
            .values(
                prepared.optionPromotions.map((option) => ({
                    id: option.id,
                    tenantId: option.teamId,
                    customFieldId: option.customFieldId,
                    name: option.label,
                    sortOrder: option.sortOrder,
                    settings: null,
                    createdAt: occurredAt,
                    updatedAt: occurredAt,
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

    if (prepared.mutations.length === 0) {
        return;
    }

    await transaction
        .insert(customFieldValues)
        .values(
            prepared.mutations.map((mutation) => ({
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
};
