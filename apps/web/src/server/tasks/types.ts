import type { CustomFieldsApiObject } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

export const taskIncludes = [
    "creator",
    "assignees",
    "companies",
    "people",
    "opportunities",
    "assigneesCount",
    "companiesCount",
    "peopleCount",
    "opportunitiesCount",
] as const;

export type TaskInclude = (typeof taskIncludes)[number];

export const taskCountIncludes = [
    "assigneesCount",
    "companiesCount",
    "peopleCount",
    "opportunitiesCount",
] as const;

export type TaskCountInclude = (typeof taskCountIncludes)[number];
export type SortDirection = "asc" | "desc";

export type TaskSort = Readonly<{
    field: string;
    direction: SortDirection;
}>;

export type TaskCustomFieldFilter = Readonly<{
    code: string;
    operator: string;
    operand: string | readonly string[];
}>;

export type TaskListQuery = Readonly<{
    page: number;
    perPage: number;
    filters: Readonly<{
        title?: string;
        assignedToMe?: boolean;
        assigneeIds?: readonly string[];
        companyId?: string;
        peopleId?: string;
        opportunityId?: string;
        createdAfter?: string;
        createdBefore?: string;
        customFields: readonly TaskCustomFieldFilter[];
    }>;
    sorts: readonly TaskSort[];
    includes: readonly TaskInclude[];
}>;

export type TaskRecord = Readonly<{
    id: Ulid;
    teamId: Ulid;
    creatorId: Ulid | null;
    title: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type TaskUserRecord = Readonly<{
    id: Ulid;
    name: string;
    email: string;
}>;

export type TaskUserRelationship = Readonly<{
    taskId: Ulid;
    user: TaskUserRecord;
}>;

export type TaskCompanyRecord = Readonly<{
    taskId: Ulid;
    id: Ulid;
    teamId: Ulid;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type TaskPersonRecord = Readonly<{
    taskId: Ulid;
    id: Ulid;
    teamId: Ulid;
    companyId: Ulid | null;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type TaskOpportunityRecord = Readonly<{
    taskId: Ulid;
    id: Ulid;
    teamId: Ulid;
    companyId: Ulid | null;
    contactId: Ulid | null;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type TaskRelationshipCounts = Readonly<{
    assigneesCount?: number;
    companiesCount?: number;
    peopleCount?: number;
    opportunitiesCount?: number;
}>;

export type TaskCompanyView = Readonly<{
    record: TaskCompanyRecord;
    customFields: CustomFieldsApiObject;
}>;

export type TaskPersonView = Readonly<{
    record: TaskPersonRecord;
    customFields: CustomFieldsApiObject;
}>;

export type TaskOpportunityView = Readonly<{
    record: TaskOpportunityRecord;
    customFields: CustomFieldsApiObject;
}>;

export type TaskView = Readonly<{
    record: TaskRecord;
    customFields: CustomFieldsApiObject;
    creator?: TaskUserRecord | null;
    assignees?: readonly TaskUserRecord[];
    companies?: readonly TaskCompanyView[];
    people?: readonly TaskPersonView[];
    opportunities?: readonly TaskOpportunityView[];
    counts: TaskRelationshipCounts;
}>;

export type TaskListPage = Readonly<{
    records: readonly TaskRecord[];
    total: number;
}>;

export type TaskListView = Readonly<{
    tasks: readonly TaskView[];
    page: number;
    perPage: number;
    total: number;
}>;

export type TaskRelationshipIds = Readonly<{
    companyIds?: readonly Ulid[];
    peopleIds?: readonly Ulid[];
    opportunityIds?: readonly Ulid[];
    assigneeIds?: readonly Ulid[];
}>;

export type CreateTaskData = TaskRelationshipIds &
    Readonly<{
        title: string;
        customFields?: unknown;
    }>;

export type UpdateTaskData = TaskRelationshipIds &
    Readonly<{
        title?: string;
        customFields?: unknown;
    }>;
