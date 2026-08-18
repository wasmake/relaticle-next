import {
    ApiValidationError,
    type ApiValidationIssue,
} from "@/server/api/errors";
import { ulidSchema, type Ulid } from "@/server/ids";

import type {
    CreateTaskData,
    TaskRelationshipIds,
    UpdateTaskData,
} from "./types";

const relationshipFields = [
    ["company_ids", "companyIds"],
    ["people_ids", "peopleIds"],
    ["opportunity_ids", "opportunityIds"],
    ["assignee_ids", "assigneeIds"],
] as const;

const validateTitle = (
    value: unknown,
    required: boolean,
    issues: ApiValidationIssue[],
): string | undefined => {
    if (value === undefined && !required) {
        return undefined;
    }

    if (typeof value !== "string" || value === "") {
        issues.push({ path: "title", message: "The title field is required." });

        return undefined;
    }

    if ([...value].length > 255) {
        issues.push({
            path: "title",
            message: "The title field must not be greater than 255 characters.",
        });

        return undefined;
    }

    return value;
};

const validateRelationshipIds = (
    body: Readonly<Record<string, unknown>>,
    issues: ApiValidationIssue[],
): TaskRelationshipIds => {
    const relationships: {
        companyIds?: readonly Ulid[];
        peopleIds?: readonly Ulid[];
        opportunityIds?: readonly Ulid[];
        assigneeIds?: readonly Ulid[];
    } = {};

    for (const [requestField, dataField] of relationshipFields) {
        if (!Object.hasOwn(body, requestField)) {
            continue;
        }

        const value = body[requestField];

        if (value === null) {
            relationships[dataField] = [];
            continue;
        }

        if (!Array.isArray(value)) {
            issues.push({
                path: requestField,
                message: `The ${requestField} field must be an array.`,
            });
            continue;
        }

        const ids: Ulid[] = [];

        for (const [index, item] of value.entries()) {
            const parsed = ulidSchema.safeParse(item);

            if (!parsed.success) {
                issues.push({
                    path: `${requestField}.${index}`,
                    message: `The selected ${requestField}.${index} is invalid.`,
                });
                continue;
            }

            ids.push(parsed.data);
        }

        relationships[dataField] = ids;
    }

    return relationships;
};

export const validateCreateTask = (
    body: Readonly<Record<string, unknown>>,
): CreateTaskData => {
    const issues: ApiValidationIssue[] = [];
    const title = validateTitle(body.title, true, issues);
    const relationships = validateRelationshipIds(body, issues);

    if (issues.length > 0 || title === undefined) {
        throw new ApiValidationError(issues);
    }

    return {
        title,
        ...relationships,
        ...(Object.hasOwn(body, "custom_fields")
            ? { customFields: body.custom_fields }
            : {}),
    };
};

export const validateUpdateTask = (
    body: Readonly<Record<string, unknown>>,
): UpdateTaskData => {
    const issues: ApiValidationIssue[] = [];
    const title = Object.hasOwn(body, "title")
        ? validateTitle(body.title, true, issues)
        : undefined;
    const relationships = validateRelationshipIds(body, issues);

    if (issues.length > 0) {
        throw new ApiValidationError(issues);
    }

    return {
        ...relationships,
        ...(title === undefined ? {} : { title }),
        ...(Object.hasOwn(body, "custom_fields")
            ? { customFields: body.custom_fields }
            : {}),
    };
};
