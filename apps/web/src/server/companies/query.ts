import { ApiBadRequestError, ApiValidationError } from "@/server/api/errors";

import {
    companyIncludes,
    type CompanyInclude,
    type CompanyListQuery,
    type CompanySort,
    type CompanySortField,
} from "./types";

const allowedFilters = new Set(["name", "created_after", "created_before"]);
const allowedSorts = new Set<CompanySortField>([
    "name",
    "created_at",
    "updated_at",
]);
const allowedIncludes = new Set<CompanyInclude>(companyIncludes);
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;

const singleParameter = (
    parameters: URLSearchParams,
    name: string,
): string | undefined => {
    const values = parameters.getAll(name);

    if (values.length > 1) {
        throw new ApiBadRequestError(`Query parameter ${name} may only be supplied once.`);
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
            { path, message: `The ${path} field must not be greater than ${maximum}.` },
        ]);
    }

    return parsed;
};

const assertDate = (value: string, filter: string): string => {
    const match = datePattern.exec(value);

    if (match === null) {
        throw new ApiBadRequestError(`Filter ${filter} must use YYYY-MM-DD format.`);
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

const parseFilters = (
    parameters: URLSearchParams,
): CompanyListQuery["filters"] => {
    const filters: {
        name?: string;
        createdAfter?: string;
        createdBefore?: string;
    } = {};

    for (const [key, value] of parameters.entries()) {
        if (!key.startsWith("filter[")) {
            continue;
        }

        const match = /^filter\[([^\]]+)\]$/u.exec(key);
        const filter = match?.[1];

        if (filter === undefined || !allowedFilters.has(filter)) {
            throw new ApiBadRequestError(
                `Requested filter ${filter ?? key} is not allowed.`,
            );
        }

        if (parameters.getAll(key).length > 1) {
            throw new ApiBadRequestError(`Filter ${filter} may only be supplied once.`);
        }

        const normalizedValue = value.trim();

        if (filter === "name") {
            filters.name = normalizedValue;
        } else if (filter === "created_after") {
            filters.createdAfter = assertDate(normalizedValue, filter);
        } else {
            filters.createdBefore = assertDate(normalizedValue, filter);
        }
    }

    if (parameters.has("filter")) {
        throw new ApiBadRequestError("Requested filter syntax is not allowed.");
    }

    return filters;
};

const parseSorts = (value: string | undefined): readonly CompanySort[] => {
    if (value === undefined) {
        return [{ field: "created_at", direction: "desc" }];
    }

    if (value === "") {
        throw new ApiBadRequestError("Sort must name at least one allowed field.");
    }

    return value.split(",").map((item): CompanySort => {
        const descending = item.startsWith("-");
        const field = (descending ? item.slice(1) : item) as CompanySortField;

        if (!allowedSorts.has(field)) {
            throw new ApiBadRequestError(`Requested sort ${field} is not allowed.`);
        }

        return { field, direction: descending ? "desc" : "asc" };
    });
};

export const parseCompanyIncludes = (
    parameters: URLSearchParams,
): readonly CompanyInclude[] => {
    const value = singleParameter(parameters, "include");

    if (value === undefined || value === "") {
        return [];
    }

    const includes: CompanyInclude[] = [];

    for (const item of value.split(",")) {
        if (!allowedIncludes.has(item as CompanyInclude)) {
            throw new ApiBadRequestError(`Requested include ${item} is not allowed.`);
        }

        if (!includes.includes(item as CompanyInclude)) {
            includes.push(item as CompanyInclude);
        }
    }

    return includes;
};

export const parseCompanyListQuery = (url: URL): CompanyListQuery => {
    if (url.searchParams.has("cursor")) {
        throw new ApiBadRequestError("Cursor pagination is not supported by this endpoint.");
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
        includes: parseCompanyIncludes(url.searchParams),
    };
};
