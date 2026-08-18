import { ApiValidationError } from "@/server/api/errors";

import type { CreateCompanyData, UpdateCompanyData } from "./types";

const validateName = (value: unknown, required: boolean): string | undefined => {
    if (value === undefined && !required) {
        return undefined;
    }

    if (typeof value !== "string" || value === "") {
        throw new ApiValidationError([
            { path: "name", message: "The name field is required." },
        ]);
    }

    if ([...value].length > 255) {
        throw new ApiValidationError([
            {
                path: "name",
                message: "The name field must not be greater than 255 characters.",
            },
        ]);
    }

    return value;
};

export const validateCreateCompany = (
    body: Readonly<Record<string, unknown>>,
): CreateCompanyData => {
    const name = validateName(body.name, true);

    if (name === undefined) {
        throw new ApiValidationError([
            { path: "name", message: "The name field is required." },
        ]);
    }

    return {
        name,
        ...(Object.hasOwn(body, "custom_fields")
            ? { customFields: body.custom_fields }
            : {}),
    };
};

export const validateUpdateCompany = (
    body: Readonly<Record<string, unknown>>,
): UpdateCompanyData => {
    const name = Object.hasOwn(body, "name")
        ? validateName(body.name, true)
        : undefined;

    return {
        ...(name === undefined ? {} : { name }),
        ...(Object.hasOwn(body, "custom_fields")
            ? { customFields: body.custom_fields }
            : {}),
    };
};
