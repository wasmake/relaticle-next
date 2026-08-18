import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";

import type { CustomFieldEncryption } from "@/server/custom-fields/types";
import { customFieldStorageColumnForType } from "@/server/custom-fields/storage";
import type {
    CustomFieldStorageValues,
    CustomFieldType,
    PreparedCustomFieldWrite,
} from "@/server/custom-fields/types";
import { isEncryptedCustomField } from "@/server/custom-fields/validation";
import type { DatabaseTransaction } from "@/server/custom-fields/persist";
import {
    activityLog,
    customFieldOptions,
    customFields,
    customFieldValues,
} from "@/server/db/schema";
import type { JsonValue } from "@/server/db/schema/shared";
import type { Ulid } from "@/server/ids";

export type ActivitySubjectType =
    | "company"
    | "people"
    | "opportunity"
    | "task"
    | "note";

export type NativeActivityEvent = "created" | "updated" | "deleted";

export type NativeActivityValue = boolean | number | string | null;

export type NativeActivityInput = Readonly<{
    teamId: Ulid;
    subjectType: ActivitySubjectType;
    subjectId: Ulid;
    causerId: Ulid;
    event: NativeActivityEvent;
    attributes?: Readonly<Record<string, NativeActivityValue>>;
    old?: Readonly<Record<string, NativeActivityValue>>;
    batchUuid: string;
    occurredAt: Date;
}>;

type CustomFieldDefinitionRow = Readonly<{
    id: string;
    code: string;
    name: string;
    type: string;
    settings: JsonValue | null;
}>;

type CustomFieldValue =
    | boolean
    | number
    | string
    | bigint
    | Date
    | readonly JsonValue[]
    | null;

type DescribedValue = Readonly<{
    value: JsonValue;
    label: string;
}>;

const isSingleChoice = (type: string): boolean =>
    type === "select" || type === "radio" || type === "toggle-buttons";

const isMultiChoice = (type: string): boolean =>
    [
        "email",
        "phone",
        "link",
        "tags-input",
        "checkbox-list",
        "multi-select",
        "record",
    ].includes(type);

const isEmpty = (value: CustomFieldValue): boolean =>
    value === null || value === "" || (Array.isArray(value) && value.length === 0);

const comparableValue = (value: CustomFieldValue): string => {
    if (typeof value === "bigint") {
        return `bigint:${value.toString()}`;
    }

    if (value instanceof Date) {
        return `date:${value.toISOString()}`;
    }

    return JSON.stringify(value);
};

const jsonValue = (value: CustomFieldValue): JsonValue => {
    if (typeof value === "bigint") {
        return JSON.rawJSON(value.toString()) as JsonValue;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return value as JsonValue;
};

const dateTimeLabel = (value: Date): string =>
    value.toISOString().slice(0, 19).replace("T", " ");

const describeValue = (
    definition: CustomFieldDefinitionRow,
    value: CustomFieldValue,
    optionLabels: ReadonlyMap<string, string>,
): DescribedValue => {
    if (isEmpty(value)) {
        return { value: null, label: "—" };
    }

    let label: string;

    if (isSingleChoice(definition.type)) {
        label = optionLabels.get(String(value)) ?? String(value);
    } else if (isMultiChoice(definition.type) && Array.isArray(value)) {
        label = value
            .map((item) => optionLabels.get(String(item)) ?? String(item))
            .filter((item) => item !== "")
            .join(", ");
    } else if (typeof value === "boolean") {
        label = value ? "Yes" : "No";
    } else if (value instanceof Date) {
        label = dateTimeLabel(value);
    } else {
        label = String(value);
    }

    return { value: jsonValue(value), label };
};

const valueFor = (
    definition: CustomFieldDefinitionRow,
    values: CustomFieldStorageValues,
    encryption: CustomFieldEncryption | undefined,
): CustomFieldValue => {
    const column = customFieldStorageColumnForType(
        definition.type as CustomFieldType,
    );
    const value = values[column];

    if (!isEncryptedCustomField(definition)) {
        return value;
    }

    if (value === null) {
        return null;
    }

    if (typeof value !== "string" || encryption === undefined) {
        throw new Error(
            `Encrypted custom field ${definition.code} cannot be logged without Laravel key compatibility.`,
        );
    }

    return encryption.decrypt(value);
};

const storageValues = (
    value: typeof customFieldValues.$inferSelect | undefined,
): CustomFieldStorageValues => ({
    stringValue: value?.stringValue ?? null,
    textValue: value?.textValue ?? null,
    booleanValue: value?.booleanValue ?? null,
    integerValue: value?.integerValue ?? null,
    floatValue: value?.floatValue ?? null,
    dateValue: value?.dateValue ?? null,
    datetimeValue: value?.datetimeValue ?? null,
    jsonValue: Array.isArray(value?.jsonValue) ? value.jsonValue : null,
});

export class ActivityWriter {
    public constructor(
        private readonly enabled: boolean,
        private readonly encryption?: CustomFieldEncryption,
        private readonly createBatchUuid: () => string = randomUUID,
    ) {}

    public batchUuid(): string {
        return this.createBatchUuid();
    }

    public async writeNative(
        transaction: DatabaseTransaction,
        input: NativeActivityInput,
    ): Promise<void> {
        if (!this.enabled) {
            return;
        }

        const attributes = input.attributes ?? {};

        if (input.event === "updated" && Object.keys(attributes).length === 0) {
            return;
        }

        const attributeChanges: Record<string, JsonValue> = {};

        if (Object.keys(attributes).length > 0) {
            attributeChanges.attributes = attributes;
        }
        if (input.old !== undefined && Object.keys(input.old).length > 0) {
            attributeChanges.old = input.old;
        }

        await transaction.insert(activityLog).values({
            teamId: input.teamId,
            logName: "crm",
            description: input.event,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            event: input.event,
            causerType: "user",
            causerId: input.causerId,
            attributeChanges,
            properties: {},
            batchUuid: input.batchUuid,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
        });
    }

    public async writeCustomFields(
        transaction: DatabaseTransaction,
        prepared: PreparedCustomFieldWrite,
        causerId: Ulid,
        batchUuid: string,
        occurredAt: Date,
    ): Promise<void> {
        if (!this.enabled || prepared.mutations.length === 0) {
            return;
        }

        const fieldIds = prepared.mutations.map(({ customFieldId }) => customFieldId);
        const [definitions, options, existingValues] = await Promise.all([
            transaction
                .select({
                    id: customFields.id,
                    code: customFields.code,
                    name: customFields.name,
                    type: customFields.type,
                    settings: customFields.settings,
                })
                .from(customFields)
                .where(
                    and(
                        eq(customFields.tenantId, prepared.teamId),
                        eq(customFields.entityType, prepared.entityType),
                        inArray(customFields.id, fieldIds),
                    ),
                ),
            transaction
                .select({
                    customFieldId: customFieldOptions.customFieldId,
                    id: customFieldOptions.id,
                    name: customFieldOptions.name,
                })
                .from(customFieldOptions)
                .where(
                    and(
                        eq(customFieldOptions.tenantId, prepared.teamId),
                        inArray(customFieldOptions.customFieldId, fieldIds),
                    ),
                ),
            transaction
                .select()
                .from(customFieldValues)
                .where(
                    and(
                        eq(customFieldValues.tenantId, prepared.teamId),
                        eq(customFieldValues.entityType, prepared.entityType),
                        eq(customFieldValues.entityId, prepared.entityId),
                        inArray(customFieldValues.customFieldId, fieldIds),
                    ),
                )
                .for("update"),
        ]);
        const definitionsById = new Map(
            definitions.map((definition) => [definition.id, definition]),
        );
        const existingByFieldId = new Map(
            existingValues.map((value) => [value.customFieldId, value]),
        );
        const optionLabelsByFieldId = new Map<string, Map<string, string>>();

        for (const option of options) {
            const labels = optionLabelsByFieldId.get(option.customFieldId) ?? new Map();
            labels.set(option.id, option.name ?? option.id);
            optionLabelsByFieldId.set(option.customFieldId, labels);
        }

        for (const mutation of prepared.mutations) {
            const definition = definitionsById.get(mutation.customFieldId);

            if (definition === undefined) {
                throw new Error(
                    `Custom field ${mutation.customFieldId} disappeared before activity logging.`,
                );
            }

            const oldValue = valueFor(
                definition,
                storageValues(existingByFieldId.get(mutation.customFieldId)),
                this.encryption,
            );
            const newValue = valueFor(definition, mutation, this.encryption);

            if (
                comparableValue(oldValue) === comparableValue(newValue) ||
                (isEmpty(oldValue) && isEmpty(newValue))
            ) {
                continue;
            }

            const optionLabels =
                optionLabelsByFieldId.get(mutation.customFieldId) ?? new Map();
            const properties = {
                custom_field_changes: [
                    {
                        code: definition.code,
                        label: definition.name,
                        type: definition.type,
                        old: describeValue(definition, oldValue, optionLabels),
                        new: describeValue(definition, newValue, optionLabels),
                    },
                ],
            } as JsonValue;

            await transaction.insert(activityLog).values({
                teamId: prepared.teamId,
                logName: "crm",
                description: "custom_field_changes",
                subjectType: prepared.entityType,
                subjectId: prepared.entityId,
                event: "custom_field_changes",
                causerType: "user",
                causerId,
                attributeChanges: {},
                properties,
                batchUuid,
                createdAt: occurredAt,
                updatedAt: occurredAt,
            });
        }
    }
}
