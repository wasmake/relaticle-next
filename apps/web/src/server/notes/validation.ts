import {
    ApiValidationError,
    type ApiValidationIssue,
} from "@/server/api/errors";
import { ulidSchema, type Ulid } from "@/server/ids";

import type {
    CreateNoteData,
    NoteRelationshipSyncs,
    NoteableType,
    UpdateNoteData,
} from "./types";

const relationshipFields = {
    company: "company_ids",
    people: "people_ids",
    opportunity: "opportunity_ids",
} as const satisfies Record<NoteableType, string>;

const validateTitle = (
    value: unknown,
    required: boolean,
): string | undefined => {
    if (value === undefined && !required) {
        return undefined;
    }

    if (typeof value !== "string" || value === "") {
        throw new ApiValidationError([
            { path: "title", message: "The title field is required." },
        ]);
    }

    if ([...value].length > 255) {
        throw new ApiValidationError([
            {
                path: "title",
                message:
                    "The title field must not be greater than 255 characters.",
            },
        ]);
    }

    return value;
};

const validateRelationshipIds = (
    value: unknown,
    path: string,
): readonly Ulid[] => {
    if (value === null) {
        return [];
    }

    if (!Array.isArray(value)) {
        throw new ApiValidationError([
            {
                path,
                message: `The ${path.replaceAll("_", " ")} field must be an array.`,
            },
        ]);
    }

    const issues: ApiValidationIssue[] = [];
    const ids: Ulid[] = [];

    for (const [index, item] of value.entries()) {
        if (typeof item !== "string") {
            issues.push({
                path: `${path}.${index}`,
                message: `The ${path}.${index} field must be a string.`,
            });
            continue;
        }

        const parsed = ulidSchema.safeParse(item);

        if (!parsed.success) {
            issues.push({
                path: `${path}.${index}`,
                message: `The selected ${path}.${index} is invalid.`,
            });
            continue;
        }

        ids.push(parsed.data);
    }

    if (issues.length > 0) {
        throw new ApiValidationError(issues);
    }

    return ids;
};

const relationshipsFrom = (
    body: Readonly<Record<string, unknown>>,
): NoteRelationshipSyncs => {
    const relationships: Partial<Record<NoteableType, readonly Ulid[]>> = {};

    for (const [type, field] of Object.entries(relationshipFields) as Array<
        [NoteableType, (typeof relationshipFields)[NoteableType]]
    >) {
        if (Object.hasOwn(body, field)) {
            relationships[type] = validateRelationshipIds(body[field], field);
        }
    }

    return relationships;
};

export const validateCreateNote = (
    body: Readonly<Record<string, unknown>>,
): CreateNoteData => {
    const title = validateTitle(body.title, true);

    if (title === undefined) {
        throw new ApiValidationError([
            { path: "title", message: "The title field is required." },
        ]);
    }

    return {
        title,
        relationships: relationshipsFrom(body),
        ...(Object.hasOwn(body, "custom_fields")
            ? { customFields: body.custom_fields }
            : {}),
    };
};

export const validateUpdateNote = (
    body: Readonly<Record<string, unknown>>,
): UpdateNoteData => {
    const title = Object.hasOwn(body, "title")
        ? validateTitle(body.title, true)
        : undefined;

    return {
        ...(title === undefined ? {} : { title }),
        relationships: relationshipsFrom(body),
        ...(Object.hasOwn(body, "custom_fields")
            ? { customFields: body.custom_fields }
            : {}),
    };
};
