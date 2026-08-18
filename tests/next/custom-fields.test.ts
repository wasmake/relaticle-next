import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type {
    CustomFieldRepository,
    CustomFieldUniquenessQuery,
} from "@/server/custom-fields/repository";
import { CustomFieldsService } from "@/server/custom-fields/service";
import { LaravelCustomFieldEncryption } from "@/server/custom-fields/encryption";
import {
    customFieldStorageColumnForType,
    mapCustomFieldValueToStorage,
} from "@/server/custom-fields/storage";
import type {
    CustomFieldDefinition,
    CustomFieldEntityType,
    CustomFieldOption,
    CustomFieldOptionPromotion,
    CustomFieldStorageValues,
    CustomFieldType,
    CustomFieldValueMutation,
    CustomFieldValueRecord,
} from "@/server/custom-fields/types";
import {
    CustomFieldValidationError,
    UnsupportedCustomFieldSemanticsError,
} from "@/server/custom-fields/types";
import { customFieldValues } from "@/server/db/schema";
import { ulidSchema, type Ulid } from "@/server/ids";

const ulid = (sequence: number): Ulid =>
    ulidSchema.parse(`01J${sequence.toString().padStart(23, "0")}`);

const teamId = ulid(1);
const otherTeamId = ulid(2);
const entityId = ulid(3);

const option = (
    id: Ulid,
    customFieldId: Ulid,
    label: string,
    optionTeamId: Ulid = teamId,
): CustomFieldOption => ({
    id,
    teamId: optionTeamId,
    customFieldId,
    label,
    sortOrder: 1n,
});

const definition = (
    type: string,
    code: string,
    overrides: Partial<CustomFieldDefinition> = {},
): CustomFieldDefinition => {
    const id = overrides.id ?? ulid(100 + definitionSequence++);

    return {
        id,
        teamId,
        entityType: "company",
        code,
        name: code,
        type,
        lookupType: null,
        validationRules: {},
        settings: {},
        options: [],
        ...overrides,
    };
};

let definitionSequence = 0;

const emptyValues = (): CustomFieldStorageValues => ({
    stringValue: null,
    textValue: null,
    booleanValue: null,
    integerValue: null,
    floatValue: null,
    dateValue: null,
    datetimeValue: null,
    jsonValue: null,
});

class InMemoryCustomFieldRepository implements CustomFieldRepository {
    public readonly values: CustomFieldValueRecord[];
    public readonly promotions: CustomFieldOptionPromotion[] = [];
    public persistCalls = 0;

    public constructor(
        public readonly definitions: readonly CustomFieldDefinition[],
        values: readonly CustomFieldValueRecord[] = [],
    ) {
        this.values = [...values];
    }

    public async loadActiveDefinitions(): Promise<
        readonly CustomFieldDefinition[]
    > {
        return this.definitions;
    }

    public async loadValues(
        requestedTeamId: Ulid,
        entityType: CustomFieldEntityType,
        requestedEntityId: Ulid,
    ): Promise<readonly CustomFieldValueRecord[]> {
        return this.values.filter(
            (value) =>
                value.teamId === requestedTeamId &&
                value.entityType === entityType &&
                value.entityId === requestedEntityId,
        );
    }

    public async hasConflictingValue(
        query: CustomFieldUniquenessQuery,
    ): Promise<boolean> {
        return this.values.some(
            (value) =>
                value.teamId === query.teamId &&
                value.entityType === query.entityType &&
                value.customFieldId === query.customFieldId &&
                value.entityId !== query.entityId &&
                storageValuesOverlap(value, query.values),
        );
    }

    public async persistValues(
        mutations: readonly CustomFieldValueMutation[],
        optionPromotions: readonly CustomFieldOptionPromotion[],
    ): Promise<void> {
        this.persistCalls += 1;
        this.promotions.push(...optionPromotions);

        for (const mutation of mutations) {
            const existingIndex = this.values.findIndex(
                (value) =>
                    value.teamId === mutation.teamId &&
                    value.entityType === mutation.entityType &&
                    value.entityId === mutation.entityId &&
                    value.customFieldId === mutation.customFieldId,
            );

            if (existingIndex === -1) {
                this.values.push(mutation);
            } else {
                const existing = this.values[existingIndex];

                if (existing !== undefined) {
                    this.values[existingIndex] = {
                        ...mutation,
                        id: existing.id,
                    };
                }
            }
        }
    }
}

const storageValuesOverlap = (
    stored: CustomFieldStorageValues,
    candidate: CustomFieldStorageValues,
): boolean => {
    if (stored.jsonValue !== null && candidate.jsonValue !== null) {
        return candidate.jsonValue.some((value) => stored.jsonValue?.includes(value));
    }

    return (
        (candidate.stringValue !== null &&
            stored.stringValue === candidate.stringValue) ||
        (candidate.textValue !== null && stored.textValue === candidate.textValue) ||
        (candidate.booleanValue !== null &&
            stored.booleanValue === candidate.booleanValue) ||
        (candidate.integerValue !== null &&
            stored.integerValue === candidate.integerValue) ||
        (candidate.floatValue !== null && stored.floatValue === candidate.floatValue) ||
        (candidate.dateValue !== null && stored.dateValue === candidate.dateValue) ||
        (candidate.datetimeValue !== null &&
            stored.datetimeValue?.getTime() === candidate.datetimeValue.getTime())
    );
};

const storedValue = (
    field: CustomFieldDefinition,
    values: Partial<CustomFieldStorageValues>,
    overrides: Partial<CustomFieldValueRecord> = {},
): CustomFieldValueRecord => ({
    id: ulid(800 + definitionSequence++),
    teamId: field.teamId,
    entityType: field.entityType,
    entityId,
    customFieldId: field.id,
    ...emptyValues(),
    ...values,
    ...overrides,
});

describe("custom-field write behavior", () => {
    it.each([
        "company",
        "people",
        "opportunity",
        "task",
        "note",
    ] satisfies readonly CustomFieldEntityType[])(
        "supports create and update writes for %s",
        async (entityType) => {
            const field = definition("text", "customer_context", { entityType });
            const repository = new InMemoryCustomFieldRepository([field]);
            const service = new CustomFieldsService(repository);

            await service.write(
                { teamId },
                {
                    entityType,
                    entityId,
                    operation: "create",
                    customFields: { customer_context: "Created" },
                },
            );
            await service.write(
                { teamId },
                {
                    entityType,
                    entityId,
                    operation: "update",
                    customFields: { customer_context: "Updated" },
                },
            );

            expect(repository.values).toHaveLength(1);
            expect(repository.values[0]?.textValue).toBe("Updated");
            expect(await service.format({ teamId }, entityType, entityId)).toEqual({
                customer_context: "Updated",
            });
        },
    );

    it("preserves omitted values and retains the EAV row and ULID when clearing", async () => {
        const notes = definition("text", "notes");
        const count = definition("number", "employee_count");
        const labels = definition("multi-select", "labels", {
            options: [option(ulid(301), ulid(102), "Priority")],
            id: ulid(102),
        });
        const notesRow = storedValue(notes, { textValue: "keep me" });
        const countRow = storedValue(count, { integerValue: 42n });
        const repository = new InMemoryCustomFieldRepository(
            [notes, count, labels],
            [notesRow, countRow],
        );
        const service = new CustomFieldsService(repository);

        await service.write(
            { teamId },
            {
                entityType: "company",
                entityId,
                operation: "update",
                customFields: { employee_count: null, labels: [] },
            },
        );

        expect(repository.values.find((row) => row.customFieldId === notes.id)).toEqual(
            notesRow,
        );
        expect(repository.values.find((row) => row.customFieldId === count.id)).toMatchObject({
            id: countRow.id,
            integerValue: null,
        });
        expect(repository.values.find((row) => row.customFieldId === labels.id)).toMatchObject({
            jsonValue: [],
        });
        expect(await service.format({ teamId }, "company", entityId)).toEqual({
            notes: "keep me",
            employee_count: null,
            labels: [],
        });

        await service.write(
            { teamId },
            {
                entityType: "company",
                entityId,
                operation: "update",
            },
        );

        expect(repository.values.find((row) => row.customFieldId === notes.id)).toEqual(
            notesRow,
        );
    });

    it("leaves omitted active fields untouched when a map is supplied", async () => {
        const submitted = definition("text", "submitted");
        const omitted = definition("text", "omitted");
        const repository = new InMemoryCustomFieldRepository([
            submitted,
            omitted,
        ]);
        const service = new CustomFieldsService(repository);

        await service.write(
            { teamId },
            {
                entityType: "company",
                entityId,
                operation: "create",
                customFields: { submitted: "value" },
            },
        );

        expect(repository.values).toHaveLength(1);
        expect(
            repository.values.find(
                (value) => value.customFieldId === omitted.id,
            ),
        ).toBeUndefined();
    });

    it("rejects unknown codes without exposing another field or tenant", async () => {
        const ownField = definition("text", "public_context");
        const secretOtherTenantField = definition("text", "secret_pipeline", {
            id: ulid(401),
            teamId: otherTeamId,
        });
        const repository = new InMemoryCustomFieldRepository([
            ownField,
            secretOtherTenantField,
        ]);
        const service = new CustomFieldsService(repository);

        const promise = service.write(
            { teamId },
            {
                entityType: "company",
                entityId,
                operation: "update",
                customFields: { guessed_code: "value" },
            },
        );

        await expect(promise).rejects.toBeInstanceOf(CustomFieldValidationError);
        await expect(promise).rejects.toThrow("guessed_code");
        await expect(promise).rejects.not.toThrow("public_context");
        await expect(promise).rejects.not.toThrow("secret_pipeline");
    });

    it("accepts option IDs only from the same tenant and field", async () => {
        const fieldId = ulid(501);
        const ownOptionId = ulid(502);
        const otherTenantOptionId = ulid(503);
        const field = definition("select", "segment", {
            id: fieldId,
            options: [
                option(ownOptionId, fieldId, "Customer"),
                option(otherTenantOptionId, fieldId, "Secret", otherTeamId),
            ],
        });
        const repository = new InMemoryCustomFieldRepository([field]);
        const service = new CustomFieldsService(repository);

        await service.write(
            { teamId },
            {
                entityType: "company",
                entityId,
                operation: "update",
                customFields: { segment: ownOptionId },
            },
        );

        await expect(
            service.write(
                { teamId },
                {
                    entityType: "company",
                    entityId,
                    operation: "update",
                    customFields: { segment: otherTenantOptionId },
                },
            ),
        ).rejects.toMatchObject({
            issues: [expect.objectContaining({ path: "custom_fields.segment" })],
        });
    });
});

type SupportedTypeCase = Readonly<{
    type: CustomFieldType;
    input: unknown;
    column: keyof CustomFieldStorageValues;
    expected: unknown;
    choice?: "single" | "multi";
}>;

const supportedTypeCases: readonly SupportedTypeCase[] = [
    { type: "text", input: "Acme", column: "textValue", expected: "Acme" },
    { type: "number", input: "42", column: "integerValue", expected: 42n },
    {
        type: "email",
        input: ["sales@acme.test"],
        column: "jsonValue",
        expected: ["sales@acme.test"],
    },
    {
        type: "phone",
        input: ["+1 (415) 555-2671"],
        column: "jsonValue",
        expected: ["+1 (415) 555-2671"],
    },
    {
        type: "link",
        input: ["https://acme.test/about"],
        column: "jsonValue",
        expected: ["https://acme.test/about"],
    },
    { type: "textarea", input: "Long text", column: "textValue", expected: "Long text" },
    { type: "checkbox", input: true, column: "booleanValue", expected: true },
    {
        type: "checkbox-list",
        input: ulid(700),
        column: "jsonValue",
        expected: [ulid(700)],
        choice: "multi",
    },
    {
        type: "radio",
        input: ulid(700),
        column: "stringValue",
        expected: ulid(700),
        choice: "single",
    },
    {
        type: "rich-editor",
        input: "<p>Context</p>",
        column: "textValue",
        expected: "<p>Context</p>",
    },
    {
        type: "markdown-editor",
        input: "# Context",
        column: "textValue",
        expected: "# Context",
    },
    {
        type: "tags-input",
        input: ["Enterprise", "Expansion"],
        column: "jsonValue",
        expected: ["Enterprise", "Expansion"],
    },
    {
        type: "color-picker",
        input: "#0A80EA",
        column: "textValue",
        expected: "#0A80EA",
    },
    { type: "toggle", input: false, column: "booleanValue", expected: false },
    {
        type: "toggle-buttons",
        input: ulid(700),
        column: "stringValue",
        expected: ulid(700),
        choice: "single",
    },
    { type: "currency", input: "1234.56", column: "floatValue", expected: 1234.56 },
    { type: "date", input: "2026-08-18", column: "dateValue", expected: "2026-08-18" },
    {
        type: "date-time",
        input: "2026-08-18T14:30:00Z",
        column: "datetimeValue",
        expected: new Date("2026-08-18T14:30:00Z"),
    },
    {
        type: "select",
        input: ulid(700),
        column: "stringValue",
        expected: ulid(700),
        choice: "single",
    },
    {
        type: "multi-select",
        input: ulid(700),
        column: "jsonValue",
        expected: [ulid(700)],
        choice: "multi",
    },
];

describe("custom-field validation and storage mapping", () => {
    it.each(supportedTypeCases)(
        "maps $type to $column",
        async ({ type, input, column, expected, choice }) => {
            const fieldId = ulid(600 + definitionSequence++);
            const configuredOption = option(ulid(700), fieldId, "Configured");
            const field = definition(type, `field_${type}`, {
                id: fieldId,
                options: choice === undefined ? [] : [configuredOption],
            });
            const actualInput = choice === "multi" ? [input] : input;
            const service = new CustomFieldsService(
                new InMemoryCustomFieldRepository([field]),
            );

            const prepared = await service.prepareWrite(
                { teamId },
                {
                    entityType: "company",
                    entityId,
                    operation: "update",
                    customFields: { [field.code]: actualInput },
                },
            );
            const mutation = prepared.mutations[0];

            expect(customFieldStorageColumnForType(type)).toBe(column);
            expect(mutation?.[column]).toEqual(expected);

            for (const storageColumn of Object.keys(emptyValues()) as Array<
                keyof CustomFieldStorageValues
            >) {
                if (storageColumn !== column) {
                    expect(mutation?.[storageColumn]).toBeNull();
                }
            }
        },
    );

    it("uses the complete typed EAV column set from the Drizzle schema", () => {
        const columnNames = getTableConfig(customFieldValues).columns.map(
            (column) => column.name,
        );
        const field = definition("number", "headcount");

        expect(columnNames).toEqual(
            expect.arrayContaining([
                "string_value",
                "text_value",
                "boolean_value",
                "integer_value",
                "float_value",
                "date_value",
                "datetime_value",
                "json_value",
            ]),
        );
        expect(mapCustomFieldValueToStorage(field, 12n)).toEqual({
            ...emptyValues(),
            integerValue: 12n,
        });
    });

    it("enforces required and configured length, numeric, date, and selection rules", async () => {
        const required = definition("text", "required_context", {
            validationRules: { required: true },
        });
        const constrainedText = definition("text", "summary", {
            validationRules: { min_length: 3, max_length: 5 },
        });
        const constrainedNumber = definition("number", "score", {
            validationRules: { min_value: 1, max_value: 10 },
        });
        const constrainedDate = definition("date", "renewal_date", {
            validationRules: {
                min_date: {
                    anchor: "fixed_date",
                    fixed_date: "2026-01-01",
                    offset: 0,
                },
            },
        });
        const constrainedTags = definition("tags-input", "tags", {
            validationRules: { min_selections: 2, max_selections: 3 },
        });
        const service = new CustomFieldsService(
            new InMemoryCustomFieldRepository([
                required,
                constrainedText,
                constrainedNumber,
                constrainedDate,
                constrainedTags,
            ]),
            () => new Date("2026-08-18T12:00:00Z"),
        );

        await expect(
            service.prepareWrite(
                { teamId },
                {
                    entityType: "company",
                    entityId,
                    operation: "create",
                    customFields: {},
                },
            ),
        ).rejects.toMatchObject({
            issues: [expect.objectContaining({ path: "custom_fields.required_context" })],
        });

        await expect(
            service.prepareWrite(
                { teamId },
                {
                    entityType: "company",
                    entityId,
                    operation: "update",
                    customFields: {
                        summary: "xx",
                        score: 11,
                        renewal_date: "2025-12-31",
                        tags: ["only-one"],
                    },
                },
            ),
        ).rejects.toMatchObject({ issues: expect.arrayContaining([
            expect.objectContaining({ path: "custom_fields.summary" }),
            expect.objectContaining({ path: "custom_fields.score" }),
            expect.objectContaining({ path: "custom_fields.renewal_date" }),
            expect.objectContaining({ path: "custom_fields.tags" }),
        ]) });
    });

    it("requires boolean fields to be accepted when marked required", async () => {
        const consent = definition("toggle", "consent", {
            validationRules: { required: true },
        });
        const service = new CustomFieldsService(
            new InMemoryCustomFieldRepository([consent]),
        );

        await expect(
            service.prepareWrite(
                { teamId },
                {
                    entityType: "company",
                    entityId,
                    operation: "create",
                    customFields: { consent: false },
                },
            ),
        ).rejects.toMatchObject({
            issues: [expect.objectContaining({ path: "custom_fields.consent" })],
        });
    });

    it("rejects malformed numbers, impossible dates, and invalid multi-choice items", async () => {
        const text = definition("text", "context");
        const number = definition("number", "headcount");
        const date = definition("date", "start_date");
        const dateTime = definition("date-time", "starts_at");
        const fieldId = ulid(751);
        const multi = definition("multi-select", "regions", {
            id: fieldId,
            options: [option(ulid(752), fieldId, "EMEA")],
        });
        const service = new CustomFieldsService(
            new InMemoryCustomFieldRepository([text, number, date, dateTime, multi]),
        );

        await expect(
            service.prepareWrite(
                { teamId },
                {
                    entityType: "company",
                    entityId,
                    operation: "update",
                    customFields: {
                        context: [],
                        headcount: "1.5",
                        start_date: "2026-02-30",
                        starts_at: "2026-02-30T25:00:00Z",
                        regions: [ulid(752), ulid(753)],
                    },
                },
            ),
        ).rejects.toMatchObject({ issues: expect.arrayContaining([
            expect.objectContaining({ path: "custom_fields.context" }),
            expect.objectContaining({ path: "custom_fields.headcount" }),
            expect.objectContaining({ path: "custom_fields.start_date" }),
            expect.objectContaining({ path: "custom_fields.starts_at" }),
            expect.objectContaining({ path: "custom_fields.regions.1" }),
        ]) });
    });

    it("promotes new tag labels and checks built-in uniqueness per tenant", async () => {
        const tags = definition("tags-input", "tags");
        const domains = definition("link", "domains", {
            settings: { unique_per_entity_type: true },
        });
        const repository = new InMemoryCustomFieldRepository(
            [tags, domains],
            [
                storedValue(
                    domains,
                    { jsonValue: ["acme.test"] },
                    { entityId: ulid(990) },
                ),
            ],
        );
        const service = new CustomFieldsService(repository);

        await service.write(
            { teamId },
            {
                entityType: "company",
                entityId,
                operation: "update",
                customFields: { tags: ["Enterprise", "enterprise", "Expansion"] },
            },
        );

        expect(repository.promotions.map((promotion) => promotion.label)).toEqual([
            "Enterprise",
            "Expansion",
        ]);

        await expect(
            service.write(
                { teamId },
                {
                    entityType: "company",
                    entityId,
                    operation: "update",
                    customFields: { domains: ["https://acme.test"] },
                },
            ),
        ).rejects.toMatchObject({
            issues: [expect.objectContaining({ path: "custom_fields.domains" })],
        });
    });
});

describe("custom-field API formatting and explicit gaps", () => {
    it("serializes signed 64-bit numeric values without JavaScript rounding", async () => {
        const number = definition("number", "external_identifier");
        const repository = new InMemoryCustomFieldRepository(
            [number],
            [storedValue(number, { integerValue: 9_007_199_254_740_993n })],
        );
        const service = new CustomFieldsService(repository);

        const formatted = await service.format(
            { teamId },
            "company",
            entityId,
        );

        expect(JSON.stringify(formatted)).toBe(
            '{"external_identifier":9007199254740993}',
        );
    });

    it("formats predefined and arbitrary choices with the Laravel ID/label shape", async () => {
        const fieldId = ulid(901);
        const optionId = ulid(902);
        const stage = definition("select", "stage", {
            id: fieldId,
            options: [option(optionId, fieldId, "Qualified")],
        });
        const emails = definition("email", "emails");
        const repository = new InMemoryCustomFieldRepository([stage, emails]);
        const service = new CustomFieldsService(repository);

        await service.write(
            { teamId },
            {
                entityType: "company",
                entityId,
                operation: "update",
                customFields: {
                    stage: optionId,
                    emails: ["hello@acme.test"],
                },
            },
        );

        expect(await service.format({ teamId }, "company", entityId)).toEqual({
            stage: { id: optionId, label: "Qualified" },
            emails: [{ id: "hello@acme.test", label: "hello@acme.test" }],
        });
    });

    it("round-trips Laravel-compatible encrypted scalar values", async () => {
        const encrypted = definition("text", "private_context", {
            settings: { encrypted: true },
        });
        const repository = new InMemoryCustomFieldRepository([encrypted]);
        const encryption = new LaravelCustomFieldEncryption([
            Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
        ]);
        const service = new CustomFieldsService(
            repository,
            () => new Date(),
            encryption,
        );

        await service.write(
            { teamId },
            {
                entityType: "company",
                entityId,
                operation: "update",
                customFields: { private_context: "Confidential" },
            },
        );

        expect(repository.values[0]?.textValue).not.toBe("Confidential");
        expect(await service.format({ teamId }, "company", entityId)).toEqual({
            private_context: "Confidential",
        });
    });

    it("stores record lookup IDs without requiring custom-field options", async () => {
        const relatedCompanyId = ulid(950);
        const record = definition("record", "related_companies", {
            lookupType: "company",
            settings: { allow_multiple: true },
        });
        const repository = new InMemoryCustomFieldRepository([record]);
        const service = new CustomFieldsService(repository);

        await service.write(
            { teamId },
            {
                entityType: "company",
                entityId,
                operation: "update",
                customFields: { related_companies: [relatedCompanyId] },
            },
        );

        expect(repository.values[0]?.jsonValue).toEqual([relatedCompanyId]);
        expect(await service.format({ teamId }, "company", entityId)).toEqual({
            related_companies: [
                { id: relatedCompanyId, label: relatedCompanyId },
            ],
        });
    });

    it.each([
        {
            type: "file-upload",
            overrides: {},
            reason: "no Node media upload contract",
        },
        {
            type: "phone",
            overrides: { settings: { encrypted: true } },
            reason: "only safe for scalar text and select",
        },
    ])("fails explicitly for unsupported $type semantics", async ({ type, overrides, reason }) => {
        const field = definition(type, `unsupported_${type}`, overrides);
        const service = new CustomFieldsService(
            new InMemoryCustomFieldRepository([field]),
        );

        const promise = service.prepareWrite(
            { teamId },
            {
                entityType: "company",
                entityId,
                operation: "update",
                customFields: { [field.code]: [] },
            },
        );

        await expect(promise).rejects.toBeInstanceOf(
            UnsupportedCustomFieldSemanticsError,
        );
        await expect(promise).rejects.toThrow(reason);
    });
});
