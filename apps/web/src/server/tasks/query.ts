import { ApiBadRequestError, ApiValidationError } from "@/server/api/errors";

import {
    taskIncludes,
    type TaskCustomFieldFilter,
    type TaskInclude,
    type TaskListQuery,
    type TaskSort,
} from "./types";

const scalarFilters = new Set([
    "title",
    "assigned_to_me",
    "company_id",
    "people_id",
    "opportunity_id",
    "created_after",
    "created_before",
]);
const builtInSorts = new Set(["title", "created_at", "updated_at"]);
const reservedSorts = new Set([
    "id",
    "team_id",
    "creator_id",
    "creation_source",
    "order_column",
    "deleted_at",
]);
const allowedIncludes = new Set<TaskInclude>(taskIncludes);
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const indexedAssigneeFilter = /^filter\[assignee_ids\]\[(\d+)\]$/u;
const customFieldFilter =
    /^filter\[custom_fields\]\[([^\]]+)\]\[([^\]]+)\](?:\[(\d+)\])?$/u;

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

const booleanFilterValue = (value: string): boolean =>
    ["1", "true", "on", "yes"].includes(value.toLocaleLowerCase());

const splitList = (values: readonly string[]): readonly string[] =>
    values
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter((value) => value !== "");

const parseFilters = (
    parameters: URLSearchParams,
): TaskListQuery["filters"] => {
    const scalarValues = new Map<string, string>();
    const assigneeValues: Array<{ index: number; value: string }> = [];
    const customValues = new Map<
        string,
        Map<string, Array<{ index: number; value: string }>>
    >();
    const seenKeys = new Set<string>();

    for (const [key, rawValue] of parameters.entries()) {
        if (!key.startsWith("filter[")) {
            continue;
        }

        if (
            seenKeys.has(key) &&
            !indexedAssigneeFilter.test(key) &&
            !customFieldFilter.test(key)
        ) {
            throw new ApiBadRequestError(
                `Filter ${key} may only be supplied once.`,
            );
        }
        seenKeys.add(key);

        const scalarMatch = /^filter\[([^\]]+)\]$/u.exec(key);
        const filter = scalarMatch?.[1];

        if (filter !== undefined && scalarFilters.has(filter)) {
            if (parameters.getAll(key).length > 1) {
                throw new ApiBadRequestError(
                    `Filter ${filter} may only be supplied once.`,
                );
            }
            scalarValues.set(filter, rawValue.trim());
            continue;
        }

        if (key === "filter[assignee_ids]") {
            if (parameters.getAll(key).length > 1) {
                throw new ApiBadRequestError(
                    "Filter assignee_ids may only be supplied once.",
                );
            }
            assigneeValues.push({ index: 0, value: rawValue });
            continue;
        }

        const assigneeMatch = indexedAssigneeFilter.exec(key);

        if (assigneeMatch !== null) {
            assigneeValues.push({
                index: Number(assigneeMatch[1]),
                value: rawValue,
            });
            continue;
        }

        const customMatch = customFieldFilter.exec(key);

        if (customMatch !== null) {
            const code = customMatch[1] ?? "";
            const operator = customMatch[2] ?? "";
            const index = Number(customMatch[3] ?? 0);
            const operators = customValues.get(code) ?? new Map();
            const operands = operators.get(operator) ?? [];
            operands.push({ index, value: rawValue.trim() });
            operators.set(operator, operands);
            customValues.set(code, operators);
            continue;
        }

        if (key === "filter[custom_fields]" && rawValue.trim() === "") {
            continue;
        }

        throw new ApiBadRequestError(
            `Requested filter ${filter ?? key} is not allowed.`,
        );
    }

    if (parameters.has("filter")) {
        throw new ApiBadRequestError("Requested filter syntax is not allowed.");
    }

    if (customValues.size > 10) {
        throw new ApiValidationError([
            {
                path: "filter.custom_fields",
                message: "Maximum 10 filter conditions allowed.",
            },
        ]);
    }

    const customFields: TaskCustomFieldFilter[] = [];

    for (const [code, operators] of customValues) {
        for (const [operator, indexedValues] of operators) {
            const rawValues = indexedValues
                .sort((left, right) => left.index - right.index)
                .map(({ value }) => value);
            const values =
                operator === "in"
                    ? splitList(rawValues)
                    : rawValues.filter((value) => value !== "");
            customFields.push({
                code,
                operator,
                operand:
                    operator === "in" || indexedValues.length > 1
                        ? values
                        : (values[0] ?? ""),
            });
        }
    }

    const assignedToMe = scalarValues.get("assigned_to_me");
    const createdAfter = scalarValues.get("created_after");
    const createdBefore = scalarValues.get("created_before");
    const orderedAssignees = splitList(
        assigneeValues
            .sort((left, right) => left.index - right.index)
            .map(({ value }) => value),
    );

    return {
        ...(scalarValues.has("title")
            ? { title: scalarValues.get("title") ?? "" }
            : {}),
        ...(assignedToMe === undefined
            ? {}
            : { assignedToMe: booleanFilterValue(assignedToMe) }),
        ...(assigneeValues.length === 0
            ? {}
            : { assigneeIds: orderedAssignees }),
        ...(scalarValues.has("company_id")
            ? { companyId: scalarValues.get("company_id") ?? "" }
            : {}),
        ...(scalarValues.has("people_id")
            ? { peopleId: scalarValues.get("people_id") ?? "" }
            : {}),
        ...(scalarValues.has("opportunity_id")
            ? { opportunityId: scalarValues.get("opportunity_id") ?? "" }
            : {}),
        ...(createdAfter === undefined
            ? {}
            : { createdAfter: assertDate(createdAfter, "created_after") }),
        ...(createdBefore === undefined
            ? {}
            : { createdBefore: assertDate(createdBefore, "created_before") }),
        customFields,
    };
};

const parseSorts = (value: string | undefined): readonly TaskSort[] => {
    if (value === undefined) {
        return [{ field: "created_at", direction: "desc" }];
    }

    if (value === "") {
        throw new ApiBadRequestError(
            "Sort must name at least one allowed field.",
        );
    }

    return value.split(",").map((item): TaskSort => {
        const descending = item.startsWith("-");
        const field = descending ? item.slice(1) : item;

        if (
            field === "" ||
            reservedSorts.has(field) ||
            (!builtInSorts.has(field) && !/^[A-Za-z0-9_-]+$/u.test(field))
        ) {
            throw new ApiBadRequestError(
                `Requested sort ${field} is not allowed.`,
            );
        }

        return { field, direction: descending ? "desc" : "asc" };
    });
};

export const parseTaskIncludes = (
    parameters: URLSearchParams,
): readonly TaskInclude[] => {
    const value = singleParameter(parameters, "include");

    if (value === undefined || value === "") {
        return [];
    }

    const includes: TaskInclude[] = [];

    for (const item of value.split(",")) {
        if (!allowedIncludes.has(item as TaskInclude)) {
            throw new ApiBadRequestError(
                `Requested include ${item} is not allowed.`,
            );
        }

        if (!includes.includes(item as TaskInclude)) {
            includes.push(item as TaskInclude);
        }
    }

    return includes;
};

export const parseTaskListQuery = (url: URL): TaskListQuery => {
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
        includes: parseTaskIncludes(url.searchParams),
    };
};
