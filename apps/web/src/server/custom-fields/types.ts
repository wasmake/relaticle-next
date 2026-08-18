import type { RequestContext } from "@/server/context/request-context";
import type { JsonValue } from "@/server/db/schema/shared";
import type { Ulid } from "@/server/ids";

export const customFieldEntityTypes = [
    "company",
    "people",
    "opportunity",
    "task",
    "note",
] as const;

export type CustomFieldEntityType = (typeof customFieldEntityTypes)[number];

export const customFieldTypes = [
    "text",
    "number",
    "email",
    "phone",
    "link",
    "textarea",
    "checkbox",
    "checkbox-list",
    "radio",
    "rich-editor",
    "markdown-editor",
    "tags-input",
    "color-picker",
    "toggle",
    "toggle-buttons",
    "currency",
    "date",
    "date-time",
    "select",
    "multi-select",
    "file-upload",
    "record",
] as const;

export type CustomFieldType = (typeof customFieldTypes)[number];

export type CustomFieldOption = Readonly<{
    id: Ulid;
    teamId: Ulid;
    customFieldId: Ulid;
    label: string;
    sortOrder: bigint | null;
}>;

export type CustomFieldDefinition = Readonly<{
    id: Ulid;
    teamId: Ulid;
    entityType: CustomFieldEntityType;
    code: string;
    name: string;
    type: string;
    lookupType: string | null;
    validationRules: unknown;
    settings: unknown;
    options: readonly CustomFieldOption[];
}>;

export type CustomFieldStorageValues = Readonly<{
    stringValue: string | null;
    textValue: string | null;
    booleanValue: boolean | null;
    integerValue: bigint | null;
    floatValue: number | null;
    dateValue: string | null;
    datetimeValue: Date | null;
    jsonValue: readonly JsonValue[] | null;
}>;

export type CustomFieldValueRecord = CustomFieldStorageValues &
    Readonly<{
        id: Ulid;
        teamId: Ulid;
        entityType: CustomFieldEntityType;
        entityId: Ulid;
        customFieldId: Ulid;
    }>;

export type CustomFieldValueMutation = CustomFieldValueRecord;

export type CustomFieldOptionPromotion = Readonly<{
    id: Ulid;
    teamId: Ulid;
    customFieldId: Ulid;
    label: string;
    sortOrder: bigint;
}>;

export type CustomFieldValidationIssue = Readonly<{
    path: string;
    message: string;
}>;

export type CustomFieldsInput = Readonly<Record<string, unknown>>;

export type CustomFieldWriteOperation = "create" | "update";

export type CustomFieldWriteRequest = Readonly<{
    entityType: CustomFieldEntityType;
    entityId: Ulid;
    operation: CustomFieldWriteOperation;
    customFields?: unknown;
}>;

export type PreparedCustomFieldWrite = Readonly<{
    teamId: Ulid;
    entityType: CustomFieldEntityType;
    entityId: Ulid;
    mutations: readonly CustomFieldValueMutation[];
    optionPromotions: readonly CustomFieldOptionPromotion[];
}>;

export type CustomFieldRequestContext = Pick<RequestContext, "teamId">;

export interface CustomFieldEncryption {
    encrypt(value: string): string;
    decrypt(value: string): string;
}

export type CustomFieldApiChoice = Readonly<{
    id: string;
    label: string;
}>;

export type CustomFieldApiValue =
    | boolean
    | number
    | string
    | null
    | ReturnType<typeof JSON.rawJSON>
    | CustomFieldApiChoice
    | readonly CustomFieldApiChoice[];

export type CustomFieldsApiObject = Readonly<
    Record<string, CustomFieldApiValue>
>;

export class CustomFieldValidationError extends Error {
    public constructor(
        public readonly issues: readonly CustomFieldValidationIssue[],
    ) {
        super(issues.map(({ path, message }) => `${path}: ${message}`).join("; "));
        this.name = "CustomFieldValidationError";
    }
}

export class UnsupportedCustomFieldSemanticsError extends Error {
    public constructor(
        public readonly fieldCode: string,
        public readonly fieldType: string,
        reason: string,
    ) {
        super(
            `Custom field ${fieldCode} (${fieldType}) cannot be handled safely: ${reason}`,
        );
        this.name = "UnsupportedCustomFieldSemanticsError";
    }
}
