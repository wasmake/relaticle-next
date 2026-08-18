import type { CustomFieldsApiObject } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

export const peopleIncludes = [
    "creator",
    "company",
    "tasksCount",
    "notesCount",
] as const;

export type PeopleInclude = (typeof peopleIncludes)[number];

export const peopleCountIncludes = ["tasksCount", "notesCount"] as const;

export type PeopleCountInclude = (typeof peopleCountIncludes)[number];

export const peopleSparseFields = [
    "id",
    "name",
    "company_id",
    "creator_id",
    "created_at",
    "updated_at",
] as const;

export type PeopleSparseField = (typeof peopleSparseFields)[number];
export type PeopleNativeSortField = "name" | "created_at" | "updated_at";
export type SortDirection = "asc" | "desc";

export type PeopleSort = Readonly<{
    field: string;
    direction: SortDirection;
}>;

export type PeopleCustomFieldFilterOperator =
    "eq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "has_any";

export type PeopleCustomFieldFilter = Readonly<{
    code: string;
    operator: PeopleCustomFieldFilterOperator;
    operand: boolean | string | readonly (boolean | string)[];
}>;

export type PeopleCursorValue = boolean | number | string | null;

export type PeopleCursor = Readonly<{
    values: readonly PeopleCursorValue[];
    id: Ulid;
    pointsToNextItems: boolean;
}>;

export type PeoplePagination =
    | Readonly<{ kind: "page"; page: number }>
    | Readonly<{ kind: "cursor"; cursor?: PeopleCursor }>;

export type PeopleListQuery = Readonly<{
    pagination: PeoplePagination;
    perPage: number;
    filters: Readonly<{
        name?: string;
        companyId?: Ulid;
        createdAfter?: string;
        createdBefore?: string;
        customFields: readonly PeopleCustomFieldFilter[];
    }>;
    sorts: readonly PeopleSort[];
    includes: readonly PeopleInclude[];
    fields?: readonly PeopleSparseField[];
}>;

export type PeopleRecord = Readonly<{
    id: Ulid;
    teamId: Ulid;
    creatorId: Ulid | null;
    companyId: Ulid | null;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type PeopleUserRecord = Readonly<{
    id: Ulid;
    name: string;
    email: string;
}>;

export type PeopleCompanyRecord = Readonly<{
    id: Ulid;
    teamId: Ulid;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type PeopleCompanyView = Readonly<{
    record: PeopleCompanyRecord;
    customFields: CustomFieldsApiObject;
}>;

export type PeopleRelationshipCounts = Readonly<{
    tasksCount?: number;
    notesCount?: number;
}>;

export type PeopleView = Readonly<{
    record: PeopleRecord;
    customFields: CustomFieldsApiObject;
    creator?: PeopleUserRecord | null;
    company?: PeopleCompanyView | null;
    counts: PeopleRelationshipCounts;
    fields?: readonly PeopleSparseField[];
}>;

export type PeoplePageList = Readonly<{
    kind: "page";
    records: readonly PeopleRecord[];
    total: number;
}>;

export type PeopleCursorList = Readonly<{
    kind: "cursor";
    records: readonly PeopleRecord[];
    nextCursor: string | null;
    previousCursor: string | null;
}>;

export type PeopleListPage = PeoplePageList | PeopleCursorList;

export type PeoplePageListView = Readonly<{
    kind: "page";
    people: readonly PeopleView[];
    page: number;
    perPage: number;
    total: number;
}>;

export type PeopleCursorListView = Readonly<{
    kind: "cursor";
    people: readonly PeopleView[];
    perPage: number;
    nextCursor: string | null;
    previousCursor: string | null;
}>;

export type PeopleListView = PeoplePageListView | PeopleCursorListView;

export type CreatePeopleData = Readonly<{
    name: string;
    companyId: Ulid | null;
    customFields?: unknown;
}>;

export type UpdatePeopleData = Readonly<{
    name?: string;
    companyId?: Ulid | null;
    customFields?: unknown;
}>;
