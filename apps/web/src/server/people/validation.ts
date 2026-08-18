import { ApiValidationError } from "@/server/api/errors";
import { ulidSchema, type Ulid } from "@/server/ids";

import type { CreatePeopleData, UpdatePeopleData } from "./types";

const validateName = (
    value: unknown,
    required: boolean,
): string | undefined => {
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
                message:
                    "The name field must not be greater than 255 characters.",
            },
        ]);
    }

    return value;
};

const validateCompanyId = (value: unknown): Ulid | null => {
    if (value === null) {
        return null;
    }

    const parsed = ulidSchema.safeParse(value);

    if (!parsed.success) {
        throw new ApiValidationError([
            {
                path: "company_id",
                message: "The selected company id is invalid.",
            },
        ]);
    }

    return parsed.data;
};

export const validateCreatePeople = (
    body: Readonly<Record<string, unknown>>,
): CreatePeopleData => {
    const name = validateName(body.name, true);

    if (name === undefined) {
        throw new ApiValidationError([
            { path: "name", message: "The name field is required." },
        ]);
    }

    return {
        name,
        companyId: Object.hasOwn(body, "company_id")
            ? validateCompanyId(body.company_id)
            : null,
        ...(Object.hasOwn(body, "custom_fields")
            ? { customFields: body.custom_fields }
            : {}),
    };
};

export const validateUpdatePeople = (
    body: Readonly<Record<string, unknown>>,
): UpdatePeopleData => {
    const name = Object.hasOwn(body, "name")
        ? validateName(body.name, true)
        : undefined;

    return {
        ...(name === undefined ? {} : { name }),
        ...(Object.hasOwn(body, "company_id")
            ? { companyId: validateCompanyId(body.company_id) }
            : {}),
        ...(Object.hasOwn(body, "custom_fields")
            ? { customFields: body.custom_fields }
            : {}),
    };
};
