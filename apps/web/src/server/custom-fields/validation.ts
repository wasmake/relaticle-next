import type {
    CustomFieldDefinition,
    CustomFieldType,
    CustomFieldValidationIssue,
} from "./types";
import { UnsupportedCustomFieldSemanticsError } from "./types";

const BIGINT_MIN = -(2n ** 63n);
const BIGINT_MAX = 2n ** 63n - 1n;
const MAX_JSON_ITEMS = 500;
const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const LINK_PATTERN = /^(?:https?:\/\/)?(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?:\/.*)?$/u;
const PHONE_CHARACTERS_PATTERN = /^\+?[0-9().\-\s]+$/u;
const INTEGER_PATTERN = /^-?[0-9]+$/u;
const DECIMAL_PATTERN = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/u;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?$/u;

type UnknownRecord = Readonly<Record<string, unknown>>;

export type ValidatedCustomFieldValue = Readonly<{
    value: unknown;
    tagOptionLabels: readonly string[];
}>;

const isRecord = (value: unknown): value is UnknownRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const rulesFor = (definition: CustomFieldDefinition): UnknownRecord => {
    if (isRecord(definition.validationRules)) {
        return definition.validationRules;
    }

    if (!Array.isArray(definition.validationRules)) {
        return {};
    }

    const converted: Record<string, unknown> = {};

    for (const rule of definition.validationRules) {
        if (!isRecord(rule) || typeof rule.name !== "string") {
            continue;
        }

        const firstParameter = Array.isArray(rule.parameters)
            ? rule.parameters.find(isRecord)?.value
            : undefined;

        converted[rule.name] = firstParameter ?? true;
    }

    return converted;
};

const settingsFor = (
    definition: Pick<CustomFieldDefinition, "settings">,
): UnknownRecord =>
    isRecord(definition.settings) ? definition.settings : {};

export const isEncryptedCustomField = (
    definition: Pick<CustomFieldDefinition, "settings">,
): boolean => settingsFor(definition).encrypted === true;

const numericRule = (
    rules: UnknownRecord,
    key: string,
): number | undefined => {
    const value = rules[key];

    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && DECIMAL_PATTERN.test(value)) {
        return Number(value);
    }

    return undefined;
};

const issue = (
    definition: CustomFieldDefinition,
    message: string,
    itemIndex?: number,
): CustomFieldValidationIssue => ({
    path:
        itemIndex === undefined
            ? `custom_fields.${definition.code}`
            : `custom_fields.${definition.code}.${itemIndex}`,
    message,
});

export const isRequiredCustomField = (
    definition: CustomFieldDefinition,
): boolean => {
    const required = rulesFor(definition).required;

    return required === true || required === 1 || required === "1";
};

export const hasUniqueValueConstraint = (
    definition: CustomFieldDefinition,
): boolean => settingsFor(definition).unique_per_entity_type === true;

export const normalizeUniqueCandidate = (
    definition: CustomFieldDefinition,
    value: boolean | number | string,
): boolean | number | string => {
    if (definition.type !== "link" || typeof value !== "string") {
        return value;
    }

    return value.trim().replace(/^https?:\/\//iu, "");
};

export const assertSupportedDefinition = (
    definition: CustomFieldDefinition,
): void => {
    if (
        isEncryptedCustomField(definition) &&
        definition.type !== "text" &&
        definition.type !== "select"
    ) {
        throw new UnsupportedCustomFieldSemanticsError(
            definition.code,
            definition.type,
            "encrypted storage is only safe for scalar text and select values",
        );
    }

}

const isClearValue = (definition: CustomFieldDefinition, value: unknown): boolean =>
    value === null ||
    value === "" ||
    (Array.isArray(value) &&
        value.length === 0 &&
        [
            "email",
            "phone",
            "link",
            "tags-input",
            "checkbox-list",
            "multi-select",
            "record",
        ].includes(definition.type));

const parseText = (
    definition: CustomFieldDefinition,
    value: unknown,
    rules: UnknownRecord,
): ValidatedCustomFieldValue | CustomFieldValidationIssue => {
    if (typeof value !== "string") {
        return issue(definition, "must be a string.");
    }

    const length = [...value].length;
    const minimum = numericRule(rules, "min_length");
    const maximum = numericRule(rules, "max_length");

    if (minimum !== undefined && length < minimum) {
        return issue(definition, `must contain at least ${minimum} characters.`);
    }

    if (maximum !== undefined && length > maximum) {
        return issue(definition, `must contain no more than ${maximum} characters.`);
    }

    if (definition.type === "color-picker" && !COLOR_PATTERN.test(value)) {
        return issue(definition, "must be a three- or six-digit hexadecimal color.");
    }

    return { value, tagOptionLabels: [] };
};

const parseInteger = (
    definition: CustomFieldDefinition,
    value: unknown,
    rules: UnknownRecord,
): ValidatedCustomFieldValue | CustomFieldValidationIssue => {
    const candidate =
        typeof value === "bigint"
            ? value.toString()
            : typeof value === "number" && Number.isSafeInteger(value)
              ? value.toString()
              : typeof value === "string"
                ? value
                : undefined;

    if (candidate === undefined || !INTEGER_PATTERN.test(candidate)) {
        return issue(definition, "must be an integer.");
    }

    const parsed = BigInt(candidate);

    if (parsed < BIGINT_MIN || parsed > BIGINT_MAX) {
        return issue(definition, "must fit in a signed 64-bit integer.");
    }

    const minimum = numericRule(rules, "min_value");
    const maximum = numericRule(rules, "max_value");

    if (minimum !== undefined && Number(parsed) < minimum) {
        return issue(definition, `must be at least ${minimum}.`);
    }

    if (maximum !== undefined && Number(parsed) > maximum) {
        return issue(definition, `must be no more than ${maximum}.`);
    }

    return { value: parsed, tagOptionLabels: [] };
};

const currencyDecimalPlaces = (
    definition: CustomFieldDefinition,
    rules: UnknownRecord,
): number => {
    const settings = settingsFor(definition);
    const additional = isRecord(settings.additional) ? settings.additional : {};
    const configured = additional.decimal_places ?? rules.decimal_places;
    const currencyCode =
        typeof additional.currency_code === "string"
            ? additional.currency_code
            : "USD";
    const currencyDefault = new Intl.NumberFormat("en", {
        style: "currency",
        currency: currencyCode,
    }).resolvedOptions().maximumFractionDigits ?? 2;
    const parsed =
        typeof configured === "number"
            ? configured
            : typeof configured === "string" && INTEGER_PATTERN.test(configured)
              ? Number(configured)
              : currencyDefault;

    return Math.max(0, Math.min(15, Math.trunc(parsed)));
};

const parseCurrency = (
    definition: CustomFieldDefinition,
    value: unknown,
    rules: UnknownRecord,
): ValidatedCustomFieldValue | CustomFieldValidationIssue => {
    const candidate =
        typeof value === "number" && Number.isFinite(value)
            ? value.toString()
            : typeof value === "string"
              ? value
              : undefined;

    if (candidate === undefined || !DECIMAL_PATTERN.test(candidate)) {
        return issue(definition, "must be a finite number.");
    }

    const parsed = Number(candidate);

    if (!Number.isFinite(parsed)) {
        return issue(definition, "must be a finite number.");
    }

    const decimalPart = candidate.split(".")[1] ?? "";
    const decimalPlaces = currencyDecimalPlaces(definition, rules);

    if (decimalPart.length > decimalPlaces) {
        return issue(
            definition,
            `must have no more than ${decimalPlaces} decimal places.`,
        );
    }

    const minimum = numericRule(rules, "min_value");
    const maximum = numericRule(rules, "max_value");

    if (minimum !== undefined && parsed < minimum) {
        return issue(definition, `must be at least ${minimum}.`);
    }

    if (maximum !== undefined && parsed > maximum) {
        return issue(definition, `must be no more than ${maximum}.`);
    }

    return { value: parsed, tagOptionLabels: [] };
};

const parseBoolean = (
    definition: CustomFieldDefinition,
    value: unknown,
): ValidatedCustomFieldValue | CustomFieldValidationIssue => {
    if (value === true || value === false) {
        return { value, tagOptionLabels: [] };
    }

    if (value === 1 || value === "1") {
        return { value: true, tagOptionLabels: [] };
    }

    if (value === 0 || value === "0") {
        return { value: false, tagOptionLabels: [] };
    }

    return issue(definition, "must be true or false.");
};

const parseDateOnly = (value: string): Date | undefined => {
    const match = DATE_PATTERN.exec(value);

    if (match === null) {
        return undefined;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));

    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        return undefined;
    }

    return parsed;
};

const parseDateTime = (value: string): Date | undefined => {
    const match = DATE_TIME_PATTERN.exec(value);

    if (match === null || match[1] === undefined) {
        return undefined;
    }

    if (
        parseDateOnly(match[1]) === undefined ||
        Number(match[2]) > 23 ||
        Number(match[3]) > 59 ||
        Number(match[4] ?? 0) > 59
    ) {
        return undefined;
    }

    const normalized =
        match[5] === undefined
            ? `${value.replace(" ", "T")}Z`
            : value.replace(" ", "T");
    const parsed = new Date(normalized);

    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const addUtcDateOffset = (
    date: Date,
    amount: number,
    unit: string,
): Date => {
    const result = new Date(date);

    if (unit === "days") {
        result.setUTCDate(result.getUTCDate() + amount);
    } else if (unit === "weeks") {
        result.setUTCDate(result.getUTCDate() + amount * 7);
    } else if (unit === "months") {
        result.setUTCMonth(result.getUTCMonth() + amount);
    } else if (unit === "quarters") {
        result.setUTCMonth(result.getUTCMonth() + amount * 3);
    } else if (unit === "years") {
        result.setUTCFullYear(result.getUTCFullYear() + amount);
    }

    return result;
};

const resolveDateBoundary = (
    constraint: unknown,
    now: Date,
): Date | undefined => {
    if (!isRecord(constraint) || typeof constraint.anchor !== "string") {
        return undefined;
    }

    let boundary: Date | undefined;

    if (constraint.anchor === "today") {
        boundary = new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        );
    } else if (
        constraint.anchor === "fixed_date" &&
        typeof constraint.fixed_date === "string"
    ) {
        boundary = parseDateOnly(constraint.fixed_date);
    } else {
        // Runtime-context constraints are intentionally outside API validation.
        return undefined;
    }

    if (boundary === undefined) {
        return undefined;
    }

    const offset =
        typeof constraint.offset === "number" && Number.isInteger(constraint.offset)
            ? constraint.offset
            : 0;
    const direction = constraint.offset_direction === "before" ? -1 : 1;
    const unit =
        typeof constraint.offset_unit === "string"
            ? constraint.offset_unit
            : "days";

    return addUtcDateOffset(boundary, offset * direction, unit);
};

const parseDateValue = (
    definition: CustomFieldDefinition,
    value: unknown,
    rules: UnknownRecord,
    now: Date,
): ValidatedCustomFieldValue | CustomFieldValidationIssue => {
    if (typeof value !== "string") {
        return issue(definition, "must be a date string.");
    }

    const date =
        definition.type === "date" ? parseDateOnly(value) : parseDateTime(value);

    if (date === undefined) {
        return issue(
            definition,
            definition.type === "date"
                ? "must use YYYY-MM-DD format."
                : "must be a valid ISO 8601 date-time.",
        );
    }

    const comparable = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    const minimum = resolveDateBoundary(rules.min_date, now);
    const maximum = resolveDateBoundary(rules.max_date, now);

    if (minimum !== undefined && comparable < minimum) {
        return issue(definition, "must be on or after the configured minimum date.");
    }

    if (maximum !== undefined && comparable > maximum) {
        return issue(definition, "must be on or before the configured maximum date.");
    }

    return {
        value: definition.type === "date" ? value : date,
        tagOptionLabels: [],
    };
};

const parseSingleChoice = (
    definition: CustomFieldDefinition,
    value: unknown,
): ValidatedCustomFieldValue | CustomFieldValidationIssue => {
    if (typeof value !== "string") {
        return issue(definition, "must be one configured option ID.");
    }

    if (!definition.options.some((option) => option.id === value)) {
        return issue(definition, "contains an option ID that is not valid for this field.");
    }

    return { value, tagOptionLabels: [] };
};

const validateArbitraryItem = (
    definition: CustomFieldDefinition,
    value: unknown,
    index: number,
): CustomFieldValidationIssue | undefined => {
    if (typeof value !== "string") {
        return issue(definition, "must be a string.", index);
    }

    if (definition.type === "email" && (value.length > 254 || !EMAIL_PATTERN.test(value))) {
        return issue(definition, "must be a valid email address.", index);
    }

    if (definition.type === "phone") {
        const digits = value.replace(/\D/gu, "");

        if (
            !PHONE_CHARACTERS_PATTERN.test(value) ||
            digits.length < 7 ||
            digits.length > 15
        ) {
            return issue(definition, "must be a valid phone number.", index);
        }
    }

    if (definition.type === "link" && (value.length > 2048 || !LINK_PATTERN.test(value))) {
        return issue(definition, "must be a valid website URL or domain.", index);
    }

    return undefined;
};

const parseMultiChoice = (
    definition: CustomFieldDefinition,
    value: unknown,
    rules: UnknownRecord,
): ValidatedCustomFieldValue | CustomFieldValidationIssue => {
    if (!Array.isArray(value)) {
        return issue(definition, "must be an array.");
    }

    const supportsSelectionRules = [
        "checkbox-list",
        "multi-select",
        "tags-input",
        "record",
    ].includes(definition.type);
    const minimum = supportsSelectionRules
        ? numericRule(rules, "min_selections")
        : undefined;
    const configuredMaximum = supportsSelectionRules
        ? numericRule(rules, "max_selections")
        : undefined;
    const maximum = Math.min(configuredMaximum ?? MAX_JSON_ITEMS, MAX_JSON_ITEMS);

    if (minimum !== undefined && value.length < minimum) {
        return issue(definition, `must contain at least ${minimum} values.`);
    }

    if (value.length > maximum) {
        return issue(definition, `must contain no more than ${maximum} values.`);
    }

    const arbitrary = ["email", "phone", "link", "tags-input", "record"].includes(
        definition.type,
    );

    for (const [index, item] of value.entries()) {
        if (definition.type === "record") {
            try {
                JSON.stringify(item);
            } catch {
                return issue(
                    definition,
                    "must contain JSON-compatible values.",
                    index,
                );
            }
        } else if (arbitrary) {
            const itemIssue = validateArbitraryItem(definition, item, index);

            if (itemIssue !== undefined) {
                return itemIssue;
            }
        } else if (
            typeof item !== "string" ||
            !definition.options.some((option) => option.id === item)
        ) {
            return issue(
                definition,
                "contains an option ID that is not valid for this field.",
                index,
            );
        }
    }

    const tagOptionLabels =
        definition.type === "tags-input"
            ? [...new Set(value.map((item) => (item as string).trim()).filter(Boolean))]
            : [];

    return { value: [...value], tagOptionLabels };
};

export const validateCustomFieldValue = (
    definition: CustomFieldDefinition,
    value: unknown,
    now: Date,
): ValidatedCustomFieldValue | CustomFieldValidationIssue => {
    assertSupportedDefinition(definition);

    if (isClearValue(definition, value)) {
        if (isRequiredCustomField(definition)) {
            return issue(definition, "is required.");
        }

        return {
            value: Array.isArray(value) ? [] : value === "" && [
                "text",
                "textarea",
                "rich-editor",
                "markdown-editor",
                "color-picker",
            ].includes(definition.type)
                ? ""
                : null,
            tagOptionLabels: [],
        };
    }

    const rules = rulesFor(definition);
    const type = definition.type as CustomFieldType;

    switch (type) {
        case "text":
        case "textarea":
        case "rich-editor":
        case "markdown-editor":
        case "color-picker":
            return parseText(definition, value, rules);
        case "number":
            return parseInteger(definition, value, rules);
        case "currency":
            return parseCurrency(definition, value, rules);
        case "checkbox":
        case "toggle":
            {
                const parsed = parseBoolean(definition, value);

                if (
                    !("path" in parsed) &&
                    isRequiredCustomField(definition) &&
                    parsed.value !== true
                ) {
                    return issue(definition, "must be accepted.");
                }

                return parsed;
            }
        case "date":
        case "date-time":
            return parseDateValue(definition, value, rules, now);
        case "select":
        case "radio":
        case "toggle-buttons":
            return parseSingleChoice(definition, value);
        case "email":
        case "phone":
        case "link":
        case "tags-input":
        case "checkbox-list":
        case "multi-select":
        case "record":
            return parseMultiChoice(definition, value, rules);
        case "file-upload":
            return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
                ? { value: value.toLowerCase(), tagOptionLabels: [] }
                : issue(definition, "must reference an uploaded file.");
        default:
            throw new UnsupportedCustomFieldSemanticsError(
                definition.code,
                definition.type,
                "the field type is not registered in the supported custom-field types",
            );
    }
};
