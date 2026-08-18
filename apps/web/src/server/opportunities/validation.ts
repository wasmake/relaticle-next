import { ApiValidationError } from "@/server/api/errors";
import { ulidSchema, type Ulid } from "@/server/ids";

import type { CreateOpportunityData, UpdateOpportunityData } from "./types";

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

const validateNullableId = (
    value: unknown,
    path: "company_id" | "contact_id",
): Ulid | null | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null) {
        return null;
    }

    if (typeof value !== "string") {
        throw new ApiValidationError([
            {
                path,
                message: `The ${path.replace("_", " ")} field must be a string.`,
            },
        ]);
    }

    const parsed = ulidSchema.safeParse(value);

    if (!parsed.success) {
        throw new ApiValidationError([
            {
                path,
                message: `The selected ${path.replace("_", " ")} is invalid.`,
            },
        ]);
    }

    return parsed.data;
};

export const validateCreateOpportunity = (
    body: Readonly<Record<string, unknown>>,
): CreateOpportunityData => {
    const name = validateName(body.name, true);
    const companyId = validateNullableId(body.company_id, "company_id");
    const contactId = validateNullableId(body.contact_id, "contact_id");

    if (name === undefined) {
        throw new ApiValidationError([
            { path: "name", message: "The name field is required." },
        ]);
    }

    return {
        name,
        ...(companyId === undefined ? {} : { companyId }),
        ...(contactId === undefined ? {} : { contactId }),
        ...(Object.hasOwn(body, "custom_fields")
            ? { customFields: body.custom_fields }
            : {}),
    };
};

export const validateUpdateOpportunity = (
    body: Readonly<Record<string, unknown>>,
): UpdateOpportunityData => {
    const name = Object.hasOwn(body, "name")
        ? validateName(body.name, true)
        : undefined;
    const companyId = Object.hasOwn(body, "company_id")
        ? validateNullableId(body.company_id, "company_id")
        : undefined;
    const contactId = Object.hasOwn(body, "contact_id")
        ? validateNullableId(body.contact_id, "contact_id")
        : undefined;

    return {
        ...(name === undefined ? {} : { name }),
        ...(companyId === undefined ? {} : { companyId }),
        ...(contactId === undefined ? {} : { contactId }),
        ...(Object.hasOwn(body, "custom_fields")
            ? { customFields: body.custom_fields }
            : {}),
    };
};
