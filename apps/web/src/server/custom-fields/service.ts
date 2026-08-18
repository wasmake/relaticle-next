import { createUlid } from "@/server/ids";

import type { CustomFieldRepository } from "./repository";
import {
    createCustomFieldValueMutation,
    customFieldStorageColumnForType,
    mapCustomFieldValueToStorage,
} from "./storage";
import type {
    CustomFieldApiChoice,
    CustomFieldApiValue,
    CustomFieldDefinition,
    CustomFieldEncryption,
    CustomFieldEntityType,
    CustomFieldOptionPromotion,
    CustomFieldRequestContext,
    CustomFieldsApiObject,
    CustomFieldsInput,
    CustomFieldStorageValues,
    CustomFieldType,
    CustomFieldValidationIssue,
    CustomFieldValueRecord,
    CustomFieldWriteRequest,
    PreparedCustomFieldWrite,
} from "./types";
import { CustomFieldValidationError } from "./types";
import {
    assertSupportedDefinition,
    hasUniqueValueConstraint,
    isEncryptedCustomField,
    isRequiredCustomField,
    normalizeUniqueCandidate,
    validateCustomFieldValue,
} from "./validation";

const isCustomFieldsInput = (value: unknown): value is CustomFieldsInput =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const hasValidationIssue = (
    result: ReturnType<typeof validateCustomFieldValue>,
): result is CustomFieldValidationIssue => "path" in result;

const isEmptyStoredValue = (values: CustomFieldStorageValues): boolean =>
    [
        values.stringValue,
        values.textValue,
        values.booleanValue,
        values.integerValue,
        values.floatValue,
        values.dateValue,
        values.datetimeValue,
        values.jsonValue,
    ].every(
        (value) =>
            value === null ||
            value === "" ||
            (Array.isArray(value) && value.length === 0),
    );

const toUniqueStorageValues = (
    definition: CustomFieldDefinition,
    values: CustomFieldStorageValues,
): CustomFieldStorageValues => {
    const column = customFieldStorageColumnForType(
        definition.type as CustomFieldType,
    );
    const value = values[column];

    if (Array.isArray(value)) {
        return mapCustomFieldValueToStorage(
            definition,
            value
                .filter(
                    (item): item is boolean | number | string =>
                        typeof item === "boolean" ||
                        typeof item === "number" ||
                        typeof item === "string",
                )
                .map((item) => normalizeUniqueCandidate(definition, item)),
        );
    }

    if (
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string"
    ) {
        return mapCustomFieldValueToStorage(
            definition,
            normalizeUniqueCandidate(definition, value),
        );
    }

    return values;
};

const choiceFor = (
    definition: CustomFieldDefinition,
    value: string,
): CustomFieldApiChoice => ({
    id: value,
    label:
        definition.options.find((option) => option.id === value)?.label ?? value,
});

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

const formatStoredValue = (
    definition: CustomFieldDefinition,
    record: CustomFieldValueRecord,
    encryption: CustomFieldEncryption | undefined,
): CustomFieldApiValue => {
    const type = definition.type as CustomFieldType;
    const column = customFieldStorageColumnForType(type);
    const storedValue = record[column];
    const value = isEncryptedCustomField(definition) && storedValue !== null
        ? decryptEncryptedValue(definition, storedValue, encryption)
        : storedValue;

    if (isSingleChoice(type)) {
        return typeof value === "string" ? choiceFor(definition, value) : null;
    }

    if (isMultiChoice(type)) {
        if (!Array.isArray(value)) {
            return [];
        }

        return value
            .filter(
                (item): item is number | string =>
                    typeof item === "number" || typeof item === "string",
            )
            .map((item) => choiceFor(definition, String(item)));
    }

    if (typeof value === "bigint") {
        return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
            value >= BigInt(Number.MIN_SAFE_INTEGER)
            ? Number(value)
            : JSON.rawJSON(value.toString());
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (
        value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "string"
    ) {
        return value;
    }

    return null;
};

const decryptEncryptedValue = (
    definition: CustomFieldDefinition,
    value: unknown,
    encryption: CustomFieldEncryption | undefined,
): string => {
    if (typeof value !== "string" || encryption === undefined) {
        throw new Error(
            `Encrypted custom field ${definition.code} cannot be read without Laravel key compatibility.`,
        );
    }

    return encryption.decrypt(value);
};

const encryptMutation = (
    definition: CustomFieldDefinition,
    mutation: CustomFieldValueRecord,
    encryption: CustomFieldEncryption | undefined,
): CustomFieldValueRecord => {
    if (!isEncryptedCustomField(definition)) {
        return mutation;
    }

    const column = customFieldStorageColumnForType(
        definition.type as CustomFieldType,
    );
    const value = mutation[column];

    if (value === null) {
        return mutation;
    }

    if (typeof value !== "string" || encryption === undefined) {
        throw new Error(
            `Encrypted custom field ${definition.code} cannot be written without Laravel key compatibility.`,
        );
    }

    return { ...mutation, [column]: encryption.encrypt(value) };
};

export class CustomFieldsService {
    public constructor(
        private readonly repository: CustomFieldRepository,
        private readonly now: () => Date = () => new Date(),
        private readonly encryption?: CustomFieldEncryption,
    ) {}

    public async prepareWrite(
        context: CustomFieldRequestContext,
        request: CustomFieldWriteRequest,
    ): Promise<PreparedCustomFieldWrite> {
        const definitions = await this.loadDefinitions(
            context.teamId,
            request.entityType,
        );
        const definitionsByCode = new Map(
            definitions.map((definition) => [definition.code, definition]),
        );

        if (
            request.customFields !== undefined &&
            !isCustomFieldsInput(request.customFields)
        ) {
            throw new CustomFieldValidationError([
                { path: "custom_fields", message: "must be an object." },
            ]);
        }

        const input = request.customFields ?? {};
        const submittedCodes = Object.keys(input);
        const unknownCodes = submittedCodes.filter(
            (code) => !definitionsByCode.has(code),
        );

        if (unknownCodes.length > 0) {
            throw new CustomFieldValidationError([
                {
                    path: "custom_fields",
                    message: `Unknown custom field keys: ${unknownCodes.join(", ")}.`,
                },
            ]);
        }

        const issues: CustomFieldValidationIssue[] = [];

        if (request.operation === "create") {
            for (const definition of definitions) {
                if (
                    isRequiredCustomField(definition) &&
                    !Object.hasOwn(input, definition.code)
                ) {
                    issues.push({
                        path: `custom_fields.${definition.code}`,
                        message: "is required.",
                    });
                }
            }
        }

        const validated: Array<{
            definition: CustomFieldDefinition;
            value: unknown;
            tagOptionLabels: readonly string[];
        }> = [];

        for (const code of submittedCodes) {
            const definition = definitionsByCode.get(code);

            if (definition === undefined) {
                continue;
            }

            const result = validateCustomFieldValue(
                definition,
                input[code],
                this.now(),
            );

            if (hasValidationIssue(result)) {
                issues.push(result);
            } else {
                validated.push({ definition, ...result });
            }
        }

        if (issues.length > 0) {
            throw new CustomFieldValidationError(issues);
        }

        const submittedMutations = new Map(
            validated.map(({ definition, value }) => {
                const mutation = createCustomFieldValueMutation(
                    createUlid(),
                    context.teamId,
                    request.entityType,
                    request.entityId,
                    definition,
                    value,
                );

                return [
                    definition.id,
                    encryptMutation(definition, mutation, this.encryption),
                ] as const;
            }),
        );
        const mutations = [...submittedMutations.values()];

        for (const { definition } of validated) {
            const mutation = submittedMutations.get(definition.id);

            if (
                mutation === undefined ||
                !hasUniqueValueConstraint(definition) ||
                isEmptyStoredValue(mutation)
            ) {
                continue;
            }

            const conflict = await this.repository.hasConflictingValue({
                teamId: context.teamId,
                entityType: request.entityType,
                entityId: request.entityId,
                customFieldId: definition.id,
                values: toUniqueStorageValues(definition, mutation),
            });

            if (conflict) {
                issues.push({
                    path: `custom_fields.${definition.code}`,
                    message: "contains a value already used by another record.",
                });
            }
        }

        if (issues.length > 0) {
            throw new CustomFieldValidationError(issues);
        }

        return {
            teamId: context.teamId,
            entityType: request.entityType,
            entityId: request.entityId,
            mutations,
            optionPromotions: this.prepareTagOptionPromotions(
                context.teamId,
                validated,
            ),
        };
    }

    public async persistPreparedWrite(
        context: CustomFieldRequestContext,
        prepared: PreparedCustomFieldWrite,
    ): Promise<void> {
        const hasMismatchedMutation = prepared.mutations.some(
            (mutation) =>
                mutation.teamId !== context.teamId ||
                mutation.entityType !== prepared.entityType ||
                mutation.entityId !== prepared.entityId,
        );
        const hasMismatchedPromotion = prepared.optionPromotions.some(
            (promotion) => promotion.teamId !== context.teamId,
        );

        if (
            prepared.teamId !== context.teamId ||
            hasMismatchedMutation ||
            hasMismatchedPromotion
        ) {
            throw new CustomFieldValidationError([
                {
                    path: "custom_fields",
                    message: "prepared custom fields belong to another tenant.",
                },
            ]);
        }

        await this.repository.persistValues(
            prepared.mutations,
            prepared.optionPromotions,
        );
    }

    public async write(
        context: CustomFieldRequestContext,
        request: CustomFieldWriteRequest,
    ): Promise<void> {
        const prepared = await this.prepareWrite(context, request);

        await this.persistPreparedWrite(context, prepared);
    }

    public async format(
        context: CustomFieldRequestContext,
        entityType: CustomFieldEntityType,
        entityId: CustomFieldWriteRequest["entityId"],
    ): Promise<CustomFieldsApiObject> {
        const [definitions, records] = await Promise.all([
            this.loadDefinitions(context.teamId, entityType),
            this.repository.loadValues(context.teamId, entityType, entityId),
        ]);
        const definitionsById = new Map(
            definitions.map((definition) => [definition.id, definition]),
        );
        const formatted: Record<string, CustomFieldApiValue> = {};

        for (const record of records) {
            if (
                record.teamId !== context.teamId ||
                record.entityType !== entityType ||
                record.entityId !== entityId
            ) {
                continue;
            }

            const definition = definitionsById.get(record.customFieldId);

            if (definition === undefined) {
                continue;
            }

            assertSupportedDefinition(definition);
            formatted[definition.code] = formatStoredValue(
                definition,
                record,
                this.encryption,
            );
        }

        return formatted;
    }

    private async loadDefinitions(
        teamId: CustomFieldRequestContext["teamId"],
        entityType: CustomFieldEntityType,
    ): Promise<readonly CustomFieldDefinition[]> {
        const loaded = await this.repository.loadActiveDefinitions(
            teamId,
            entityType,
        );

        return loaded
            .filter(
                (definition) =>
                    definition.teamId === teamId &&
                    definition.entityType === entityType,
            )
            .map((definition) => ({
                ...definition,
                options: definition.options.filter(
                    (option) =>
                        option.teamId === teamId &&
                        option.customFieldId === definition.id,
                ),
            }));
    }

    private prepareTagOptionPromotions(
        teamId: CustomFieldRequestContext["teamId"],
        validated: readonly {
            definition: CustomFieldDefinition;
            tagOptionLabels: readonly string[];
        }[],
    ): readonly CustomFieldOptionPromotion[] {
        const promotions: CustomFieldOptionPromotion[] = [];

        for (const { definition, tagOptionLabels } of validated) {
            if (definition.type !== "tags-input" || tagOptionLabels.length === 0) {
                continue;
            }

            const knownLabels = new Set(
                definition.options.map((option) => option.label.trim().toLocaleLowerCase()),
            );
            let sortOrder = definition.options.reduce(
                (maximum, option) =>
                    option.sortOrder !== null && option.sortOrder > maximum
                        ? option.sortOrder
                        : maximum,
                0n,
            );

            for (const label of tagOptionLabels) {
                const normalized = label.toLocaleLowerCase();

                if (knownLabels.has(normalized)) {
                    continue;
                }

                sortOrder += 1n;
                promotions.push({
                    id: createUlid(),
                    teamId,
                    customFieldId: definition.id,
                    label,
                    sortOrder,
                });
                knownLabels.add(normalized);
            }
        }

        return promotions;
    }
}
