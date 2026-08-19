import { ApiBadRequestError, ApiValidationError } from "@/server/api/errors";
import { customFieldEntityTypes, customFieldTypes } from "@/server/custom-fields/types";

import type { CustomFieldMetadataQuery } from "./types";

const allowedFilters = new Set(["entity_type", "type", "code", "active"]);

const single = (parameters: URLSearchParams, name: string): string | undefined => {
    const values = parameters.getAll(name);

    if (values.length > 1) {
        throw new ApiBadRequestError(`Query parameter ${name} may only be supplied once.`);
    }

    return values[0]?.trim();
};

const positiveInteger = (
    value: string | undefined,
    path: "page" | "per_page",
    fallback: number,
    maximum?: number,
): number => {
    if (value === undefined) {
        return fallback;
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

const filtersFrom = (parameters: URLSearchParams): CustomFieldMetadataQuery["filters"] => {
    const filters: {
        entityType?: string;
        type?: string;
        code?: string;
        active: boolean;
    } = { active: true };

    for (const [key, rawValue] of parameters.entries()) {
        if (!key.startsWith("filter[")) {
            continue;
        }

        const name = /^filter\[([^\]]+)\]$/u.exec(key)?.[1];

        if (name === undefined || !allowedFilters.has(name)) {
            throw new ApiBadRequestError(`Requested filter ${name ?? key} is not allowed.`);
        }

        if (parameters.getAll(key).length > 1) {
            throw new ApiBadRequestError(`Filter ${name} may only be supplied once.`);
        }

        const value = rawValue.trim();

        if (name === "entity_type") {
            if (!customFieldEntityTypes.includes(value as never)) {
                throw new ApiBadRequestError(`Requested entity type ${value} is not allowed.`);
            }
            filters.entityType = value;
        } else if (name === "type") {
            if (!customFieldTypes.includes(value as never)) {
                throw new ApiBadRequestError(`Requested custom field type ${value} is not allowed.`);
            }
            filters.type = value;
        } else if (name === "code") {
            filters.code = value;
        } else if (value === "true" || value === "1") {
            filters.active = true;
        } else if (value === "false" || value === "0") {
            filters.active = false;
        } else {
            throw new ApiValidationError([
                { path: "filter.active", message: "The active filter must be true or false." },
            ]);
        }
    }

    if (parameters.has("filter")) {
        throw new ApiBadRequestError("Requested filter syntax is not allowed.");
    }

    return filters;
};

export const parseCustomFieldMetadataQuery = (url: URL): CustomFieldMetadataQuery => {
    if (url.searchParams.has("cursor")) {
        throw new ApiBadRequestError("Cursor pagination is not supported by this endpoint.");
    }

    return {
        page: positiveInteger(single(url.searchParams, "page"), "page", 1),
        perPage: positiveInteger(single(url.searchParams, "per_page"), "per_page", 15, 100),
        filters: filtersFrom(url.searchParams),
    };
};
