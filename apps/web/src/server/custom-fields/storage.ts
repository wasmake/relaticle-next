import type { Ulid } from "@/server/ids";

import type {
    CustomFieldDefinition,
    CustomFieldEntityType,
    CustomFieldStorageValues,
    CustomFieldType,
    CustomFieldValueMutation,
} from "./types";

export type CustomFieldStorageColumn = keyof CustomFieldStorageValues;

const storageColumnByType: Readonly<Record<CustomFieldType, CustomFieldStorageColumn>> = {
    text: "textValue",
    number: "integerValue",
    email: "jsonValue",
    phone: "jsonValue",
    link: "jsonValue",
    textarea: "textValue",
    checkbox: "booleanValue",
    "checkbox-list": "jsonValue",
    radio: "stringValue",
    "rich-editor": "textValue",
    "markdown-editor": "textValue",
    "tags-input": "jsonValue",
    "color-picker": "textValue",
    toggle: "booleanValue",
    "toggle-buttons": "stringValue",
    currency: "floatValue",
    date: "dateValue",
    "date-time": "datetimeValue",
    select: "stringValue",
    "multi-select": "jsonValue",
    "file-upload": "stringValue",
    record: "jsonValue",
};

const emptyStorageValues = (): CustomFieldStorageValues => ({
    stringValue: null,
    textValue: null,
    booleanValue: null,
    integerValue: null,
    floatValue: null,
    dateValue: null,
    datetimeValue: null,
    jsonValue: null,
});

export const customFieldStorageColumnForType = (
    type: CustomFieldType,
): CustomFieldStorageColumn => storageColumnByType[type];

export const mapCustomFieldValueToStorage = (
    definition: CustomFieldDefinition,
    value: unknown,
): CustomFieldStorageValues => {
    const type = definition.type as CustomFieldType;
    const column = customFieldStorageColumnForType(type);
    const values = emptyStorageValues();

    return { ...values, [column]: value } as CustomFieldStorageValues;
};

export const createCustomFieldValueMutation = (
    id: Ulid,
    teamId: Ulid,
    entityType: CustomFieldEntityType,
    entityId: Ulid,
    definition: CustomFieldDefinition,
    value: unknown,
): CustomFieldValueMutation => ({
    id,
    teamId,
    entityType,
    entityId,
    customFieldId: definition.id,
    ...mapCustomFieldValueToStorage(definition, value),
});
