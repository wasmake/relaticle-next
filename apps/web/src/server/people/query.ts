import { Buffer } from "node:buffer";

import { ApiBadRequestError, ApiValidationError } from "@/server/api/errors";
import { ulidSchema } from "@/server/ids";

import {
    peopleIncludes,
    peopleSparseFields,
    type PeopleCursor,
    type PeopleCursorValue,
    type PeopleCustomFieldFilter,
    type PeopleCustomFieldFilterOperator,
    type PeopleInclude,
    type PeopleListQuery,
    type PeopleSort,
    type PeopleSparseField,
} from "./types";

const allowedNativeFilters = new Set([
    "name",
    "company_id",
    "created_after",
    "created_before",
]);
const allowedCustomFieldOperators = new Set<PeopleCustomFieldFilterOperator>([
    "eq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "in",
    "has_any",
]);
const allowedIncludes = new Set<PeopleInclude>(peopleIncludes);
const allowedSparseFields = new Set<PeopleSparseField>(peopleSparseFields);
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const nativeFilterPattern = /^filter\[([^\]]+)\]$/u;
const customFieldFilterPattern =
    /^filter\[custom_fields\]\[([^\]]+)\]\[([^\]]+)\](?:\[(\d*)\])?$/u;

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

const normalizeFilterValue = (value: string): boolean | string => {
    if (value === "true") {
        return true;
    }

    if (value === "false") {
        return false;
    }

    return value;
};

const parseFilters = (
    parameters: URLSearchParams,
): PeopleListQuery["filters"] => {
    const filters: {
        name?: string;
        companyId?: ReturnType<typeof ulidSchema.parse>;
        createdAfter?: string;
        createdBefore?: string;
        customFields: PeopleCustomFieldFilter[];
    } = { customFields: [] };
    const customValues = new Map<
        string,
        {
            code: string;
            operator: PeopleCustomFieldFilterOperator;
            values: Array<boolean | string>;
            array: boolean;
        }
    >();
    const suppliedNativeFilters = new Set<string>();

    for (const [key, value] of parameters.entries()) {
        if (!key.startsWith("filter")) {
            continue;
        }

        if (key === "filter[custom_fields]" && value.trim() === "") {
            continue;
        }

        const customMatch = customFieldFilterPattern.exec(key);

        if (customMatch !== null) {
            const code = customMatch[1];
            const operator = customMatch[2] as PeopleCustomFieldFilterOperator;
            const array = customMatch[3] !== undefined;

            if (
                code === undefined ||
                code === "" ||
                !allowedCustomFieldOperators.has(operator)
            ) {
                throw new ApiBadRequestError(
                    `Requested custom field filter ${code ?? key} is not allowed.`,
                );
            }

            if (array && operator !== "in" && operator !== "has_any") {
                throw new ApiBadRequestError(
                    `Custom field filter ${code}.${operator} does not accept an array.`,
                );
            }

            const conditionKey = `${code}\u0000${operator}`;
            const existing = customValues.get(conditionKey);

            if (existing !== undefined && (!array || !existing.array)) {
                throw new ApiBadRequestError(
                    `Custom field filter ${code}.${operator} may only be supplied once.`,
                );
            }

            const submittedValues =
                operator === "in"
                    ? value.split(",").map((item) => item.trim())
                    : [value.trim()];

            if (submittedValues.some((item) => item === "")) {
                throw new ApiBadRequestError(
                    `Custom field filter ${code}.${operator} requires a value.`,
                );
            }

            const normalizedValues = submittedValues.map(normalizeFilterValue);

            if (existing === undefined) {
                customValues.set(conditionKey, {
                    code,
                    operator,
                    values: normalizedValues,
                    array: array || operator === "in",
                });
            } else {
                existing.values.push(...normalizedValues);
            }

            continue;
        }

        const nativeMatch = nativeFilterPattern.exec(key);
        const filter = nativeMatch?.[1];

        if (
            filter === undefined ||
            filter === "custom_fields" ||
            !allowedNativeFilters.has(filter)
        ) {
            throw new ApiBadRequestError(
                `Requested filter ${filter ?? key} is not allowed.`,
            );
        }

        if (suppliedNativeFilters.has(filter)) {
            throw new ApiBadRequestError(
                `Filter ${filter} may only be supplied once.`,
            );
        }

        suppliedNativeFilters.add(filter);
        const normalizedValue = value.trim();

        if (filter === "name") {
            filters.name = normalizedValue;
        } else if (filter === "company_id") {
            const parsed = ulidSchema.safeParse(normalizedValue);

            if (!parsed.success) {
                throw new ApiBadRequestError(
                    "Filter company_id must be a valid ULID.",
                );
            }

            filters.companyId = parsed.data;
        } else if (filter === "created_after") {
            filters.createdAfter = assertDate(normalizedValue, filter);
        } else {
            filters.createdBefore = assertDate(normalizedValue, filter);
        }
    }

    const customFieldCodes = new Set(
        [...customValues.values()].map(({ code }) => code),
    );

    if (customFieldCodes.size > 10) {
        throw new ApiValidationError([
            {
                path: "filter.custom_fields",
                message: "Maximum 10 filter conditions allowed.",
            },
        ]);
    }

    filters.customFields = [...customValues.values()].map(
        ({ code, operator, values, array }): PeopleCustomFieldFilter => ({
            code,
            operator,
            operand: array ? values : (values[0] ?? ""),
        }),
    );

    return filters;
};

const parseSorts = (value: string | undefined): readonly PeopleSort[] => {
    if (value === undefined) {
        return [{ field: "created_at", direction: "desc" }];
    }

    if (value === "") {
        throw new ApiBadRequestError(
            "Sort must name at least one allowed field.",
        );
    }

    return value.split(",").map((item): PeopleSort => {
        const descending = item.startsWith("-");
        const field = descending ? item.slice(1) : item;

        if (field === "" || !/^[A-Za-z0-9_-]+$/u.test(field)) {
            throw new ApiBadRequestError(
                `Requested sort ${field} is not allowed.`,
            );
        }

        return { field, direction: descending ? "desc" : "asc" };
    });
};

export const parsePeopleIncludes = (
    parameters: URLSearchParams,
): readonly PeopleInclude[] => {
    const value = singleParameter(parameters, "include");

    if (value === undefined || value === "") {
        return [];
    }

    const includes: PeopleInclude[] = [];

    for (const item of value.split(",")) {
        if (!allowedIncludes.has(item as PeopleInclude)) {
            throw new ApiBadRequestError(
                `Requested include ${item} is not allowed.`,
            );
        }

        if (!includes.includes(item as PeopleInclude)) {
            includes.push(item as PeopleInclude);
        }
    }

    return includes;
};

const parsePeopleFields = (
    parameters: URLSearchParams,
): readonly PeopleSparseField[] | undefined => {
    for (const key of parameters.keys()) {
        if (key.startsWith("fields[") && key !== "fields[people]") {
            throw new ApiBadRequestError(
                `Requested fieldset ${key} is not allowed.`,
            );
        }
    }

    const value = singleParameter(parameters, "fields[people]");

    if (value === undefined || value === "") {
        return undefined;
    }

    const fields: PeopleSparseField[] = [];

    for (const item of value.split(",")) {
        if (!allowedSparseFields.has(item as PeopleSparseField)) {
            throw new ApiBadRequestError(
                `Requested field ${item} is not allowed.`,
            );
        }

        if (!fields.includes(item as PeopleSparseField)) {
            fields.push(item as PeopleSparseField);
        }
    }

    return fields;
};

const isCursorValue = (value: unknown): value is PeopleCursorValue =>
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string";

const decodeCursor = (value: string): PeopleCursor => {
    let parsed: unknown;

    try {
        parsed = JSON.parse(
            Buffer.from(
                value.replace(/-/gu, "+").replace(/_/gu, "/"),
                "base64",
            ).toString("utf8"),
        ) as unknown;
    } catch {
        throw new ApiBadRequestError("The cursor is invalid.");
    }

    if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
    ) {
        throw new ApiBadRequestError("The cursor is invalid.");
    }

    const object = parsed as Readonly<Record<string, unknown>>;
    const id = ulidSchema.safeParse(object.id);
    const values = Object.hasOwn(object, "values")
        ? object.values
        : Object.entries(object)
              .filter(([key]) => key !== "id" && key !== "_pointsToNextItems")
              .map(([, item]) => item);

    if (
        !id.success ||
        !Array.isArray(values) ||
        !values.every(isCursorValue) ||
        typeof object._pointsToNextItems !== "boolean"
    ) {
        throw new ApiBadRequestError("The cursor is invalid.");
    }

    return {
        values,
        id: id.data,
        pointsToNextItems: object._pointsToNextItems,
    };
};

export const encodePeopleCursor = (cursor: PeopleCursor): string =>
    Buffer.from(
        JSON.stringify({
            values: cursor.values,
            id: cursor.id,
            _pointsToNextItems: cursor.pointsToNextItems,
        }),
        "utf8",
    )
        .toString("base64")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_")
        .replace(/=+$/u, "");

const assertAllowedListParameters = (parameters: URLSearchParams): void => {
    for (const key of parameters.keys()) {
        if (
            key === "page" ||
            key === "per_page" ||
            key === "cursor" ||
            key === "sort" ||
            key === "include" ||
            key === "fields[people]" ||
            key.startsWith("filter[")
        ) {
            continue;
        }

        throw new ApiBadRequestError(
            `Query parameter ${key} is not supported.`,
        );
    }
};

const assertAllowedResourceParameters = (parameters: URLSearchParams): void => {
    for (const key of parameters.keys()) {
        if (key === "include" || key === "fields[people]") {
            continue;
        }

        throw new ApiBadRequestError(
            `Query parameter ${key} is not supported.`,
        );
    }
};

export const parsePeopleResourceQuery = (
    parameters: URLSearchParams,
): Readonly<{
    includes: readonly PeopleInclude[];
    fields?: readonly PeopleSparseField[];
}> => {
    assertAllowedResourceParameters(parameters);
    const fields = parsePeopleFields(parameters);

    return {
        includes: parsePeopleIncludes(parameters),
        ...(fields === undefined ? {} : { fields }),
    };
};

export const parsePeopleListQuery = (url: URL): PeopleListQuery => {
    assertAllowedListParameters(url.searchParams);
    const page = parsePositiveInteger(
        singleParameter(url.searchParams, "page"),
        "page",
        1,
    );
    const perPage = parsePositiveInteger(
        singleParameter(url.searchParams, "per_page"),
        "per_page",
        15,
        100,
    );
    const cursorValue = singleParameter(url.searchParams, "cursor");
    const fields = parsePeopleFields(url.searchParams);
    const pagination =
        cursorValue === undefined
            ? ({ kind: "page", page } as const)
            : cursorValue === "true"
              ? ({ kind: "cursor" } as const)
              : ({
                    kind: "cursor",
                    cursor: decodeCursor(cursorValue),
                } as const);

    return {
        pagination,
        perPage,
        filters: parseFilters(url.searchParams),
        sorts: parseSorts(singleParameter(url.searchParams, "sort")),
        includes: parsePeopleIncludes(url.searchParams),
        ...(fields === undefined ? {} : { fields }),
    };
};
