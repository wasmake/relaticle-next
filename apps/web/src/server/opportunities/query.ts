import { ApiBadRequestError, ApiValidationError } from "@/server/api/errors";

import {
    opportunityIncludes,
    type CustomFieldFilterOperator,
    type OpportunityCustomFieldFilter,
    type OpportunityInclude,
    type OpportunityListQuery,
    type OpportunitySort,
} from "./types";

const allowedScalarFilters = new Set([
    "name",
    "company_id",
    "contact_id",
    "created_after",
    "created_before",
    "stale_days",
]);
const allowedNativeSorts = new Set(["name", "created_at", "updated_at"]);
const allowedIncludes = new Set<OpportunityInclude>(opportunityIncludes);
const allowedCustomFieldOperators = new Set<CustomFieldFilterOperator>([
    "eq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "in",
    "has_any",
]);
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const customFieldFilterPattern =
    /^filter\[custom_fields\]\[([^\]]+)\]\[([^\]]+)\](\[\])?$/u;

const singleParameter = (
    parameters: URLSearchParams,
    name: string,
): string | undefined => {
    const values = parameters.getAll(name);

    if (values.length > 1) {
        throw new ApiBadRequestError(
            `Query parameter ${name} may only be supplied once.`,
        );
    }

    return values[0]?.trim();
};

const parsePositiveInteger = (
    value: string | undefined,
    path: "page" | "per_page",
    defaultValue: number,
    maximum?: number,
): number => {
    if (value === undefined) {
        return defaultValue;
    }

    if (!/^[0-9]+$/u.test(value)) {
        throw new ApiValidationError([
            { path, message: `The ${path} field must be an integer.` },
        ]);
    }

    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new ApiValidationError([
            { path, message: `The ${path} field must be at least 1.` },
        ]);
    }

    if (maximum !== undefined && parsed > maximum) {
        throw new ApiValidationError([
            {
                path,
                message: `The ${path} field must not be greater than ${maximum}.`,
            },
        ]);
    }

    return parsed;
};

const assertDate = (value: string, filter: string): string => {
    const match = datePattern.exec(value);

    if (match === null) {
        throw new ApiBadRequestError(
            `Filter ${filter} must use YYYY-MM-DD format.`,
        );
    }

    const date = new Date(`${value}T00:00:00.000Z`);

    if (
        Number.isNaN(date.getTime()) ||
        date.getUTCFullYear() !== Number(match[1]) ||
        date.getUTCMonth() + 1 !== Number(match[2]) ||
        date.getUTCDate() !== Number(match[3])
    ) {
        throw new ApiBadRequestError(`Filter ${filter} must be a valid date.`);
    }

    return value;
};

const parseStaleDays = (value: string): number => {
    if (!/^[0-9]+$/u.test(value)) {
        throw new ApiBadRequestError(
            "Filter stale_days must be a positive integer.",
        );
    }

    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new ApiBadRequestError(
            "Filter stale_days must be a positive integer.",
        );
    }

    return parsed;
};

const parseCustomFieldFilter = (
    parameters: URLSearchParams,
    key: string,
    value: string,
): OpportunityCustomFieldFilter => {
    const match = customFieldFilterPattern.exec(key);
    const code = match?.[1];
    const operator = match?.[2] as CustomFieldFilterOperator | undefined;
    const arraySyntax = match?.[3] !== undefined;

    if (
        code === undefined ||
        code === "" ||
        operator === undefined ||
        !allowedCustomFieldOperators.has(operator)
    ) {
        throw new ApiBadRequestError(`Requested filter ${key} is not allowed.`);
    }

    const suppliedValues = parameters.getAll(key).map((item) => item.trim());

    if (!arraySyntax && suppliedValues.length > 1) {
        throw new ApiBadRequestError(
            `Custom field filter ${code}.${operator} may only be supplied once.`,
        );
    }

    if (arraySyntax && operator !== "in" && operator !== "has_any") {
        throw new ApiBadRequestError(
            `Custom field filter ${code}.${operator} does not accept an array.`,
        );
    }

    const values = (arraySyntax ? suppliedValues : [value.trim()]).flatMap(
        (item) =>
            operator === "in"
                ? item.split(",").map((part) => part.trim())
                : [item],
    );

    if (values.length === 0 || values.some((item) => item === "")) {
        throw new ApiBadRequestError(
            `Custom field filter ${code}.${operator} requires a value.`,
        );
    }

    return {
        code,
        operator,
        value:
            operator === "in" || (operator === "has_any" && arraySyntax)
                ? values
                : (values[0] ?? ""),
    };
};

const parseFilters = (
    parameters: URLSearchParams,
): OpportunityListQuery["filters"] => {
    const filters: {
        name?: string;
        companyId?: string;
        contactId?: string;
        createdAfter?: string;
        createdBefore?: string;
        staleDays?: number;
        customFields: OpportunityCustomFieldFilter[];
    } = { customFields: [] };
    const processedKeys = new Set<string>();

    for (const [key, value] of parameters.entries()) {
        if (!key.startsWith("filter[")) {
            continue;
        }

        if (processedKeys.has(key)) {
            continue;
        }

        processedKeys.add(key);
        const scalarMatch = /^filter\[([^\]]+)\]$/u.exec(key);
        const scalarFilter = scalarMatch?.[1];

        if (
            scalarFilter !== undefined &&
            allowedScalarFilters.has(scalarFilter)
        ) {
            if (parameters.getAll(key).length > 1) {
                throw new ApiBadRequestError(
                    `Filter ${scalarFilter} may only be supplied once.`,
                );
            }

            const normalizedValue = value.trim();

            if (scalarFilter === "name") {
                filters.name = normalizedValue;
            } else if (scalarFilter === "company_id") {
                filters.companyId = normalizedValue;
            } else if (scalarFilter === "contact_id") {
                filters.contactId = normalizedValue;
            } else if (scalarFilter === "created_after") {
                filters.createdAfter = assertDate(
                    normalizedValue,
                    scalarFilter,
                );
            } else if (scalarFilter === "created_before") {
                filters.createdBefore = assertDate(
                    normalizedValue,
                    scalarFilter,
                );
            } else {
                filters.staleDays = parseStaleDays(normalizedValue);
            }

            continue;
        }

        if (key.startsWith("filter[custom_fields]")) {
            filters.customFields.push(
                parseCustomFieldFilter(parameters, key, value),
            );
            continue;
        }

        throw new ApiBadRequestError(
            `Requested filter ${scalarFilter ?? key} is not allowed.`,
        );
    }

    if (parameters.has("filter")) {
        throw new ApiBadRequestError("Requested filter syntax is not allowed.");
    }

    if (new Set(filters.customFields.map(({ code }) => code)).size > 10) {
        throw new ApiBadRequestError(
            "Maximum 10 custom field filter conditions allowed.",
        );
    }

    return filters;
};

const parseSorts = (value: string | undefined): readonly OpportunitySort[] => {
    if (value === undefined) {
        return [{ field: "created_at", direction: "desc" }];
    }

    if (value === "") {
        throw new ApiBadRequestError(
            "Sort must name at least one allowed field.",
        );
    }

    return value.split(",").map((item): OpportunitySort => {
        const normalized = item.trim();
        const descending = normalized.startsWith("-");
        const field = descending ? normalized.slice(1) : normalized;

        if (
            field === "" ||
            (!allowedNativeSorts.has(field) && !/^[a-zA-Z0-9_-]+$/u.test(field))
        ) {
            throw new ApiBadRequestError(
                `Requested sort ${field} is not allowed.`,
            );
        }

        return { field, direction: descending ? "desc" : "asc" };
    });
};

export const parseOpportunityIncludes = (
    parameters: URLSearchParams,
): readonly OpportunityInclude[] => {
    const value = singleParameter(parameters, "include");

    if (value === undefined || value === "") {
        return [];
    }

    const includes: OpportunityInclude[] = [];

    for (const item of value.split(",")) {
        if (!allowedIncludes.has(item as OpportunityInclude)) {
            throw new ApiBadRequestError(
                `Requested include ${item} is not allowed.`,
            );
        }

        if (!includes.includes(item as OpportunityInclude)) {
            includes.push(item as OpportunityInclude);
        }
    }

    return includes;
};

export const parseOpportunityListQuery = (url: URL): OpportunityListQuery => {
    if (url.searchParams.has("cursor")) {
        throw new ApiBadRequestError(
            "Cursor pagination is not supported by this endpoint.",
        );
    }

    return {
        page: parsePositiveInteger(
            singleParameter(url.searchParams, "page"),
            "page",
            1,
        ),
        perPage: parsePositiveInteger(
            singleParameter(url.searchParams, "per_page"),
            "per_page",
            15,
            100,
        ),
        filters: parseFilters(url.searchParams),
        sorts: parseSorts(singleParameter(url.searchParams, "sort")),
        includes: parseOpportunityIncludes(url.searchParams),
    };
};
