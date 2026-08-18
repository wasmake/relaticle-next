import type { CustomFieldsApiObject } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

export const companyIncludes = [
    "creator",
    "accountOwner",
    "people",
    "opportunities",
    "peopleCount",
    "opportunitiesCount",
    "tasksCount",
    "notesCount",
] as const;

export type CompanyInclude = (typeof companyIncludes)[number];

export const companyCountIncludes = [
    "peopleCount",
    "opportunitiesCount",
    "tasksCount",
    "notesCount",
] as const;

export type CompanyCountInclude = (typeof companyCountIncludes)[number];

export type CompanySortField = "name" | "created_at" | "updated_at";
export type SortDirection = "asc" | "desc";

export type CompanySort = Readonly<{
    field: CompanySortField;
    direction: SortDirection;
}>;

export type CompanyListQuery = Readonly<{
    page: number;
    perPage: number;
    filters: Readonly<{
        name?: string;
        createdAfter?: string;
        createdBefore?: string;
    }>;
    sorts: readonly CompanySort[];
    includes: readonly CompanyInclude[];
}>;

export type CompanyRecord = Readonly<{
    id: Ulid;
    teamId: Ulid;
    creatorId: Ulid | null;
    accountOwnerId: Ulid | null;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type CompanyUserRecord = Readonly<{
    id: Ulid;
    name: string;
    email: string;
}>;

export type CompanyPersonRecord = Readonly<{
    id: Ulid;
    teamId: Ulid;
    companyId: Ulid;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type CompanyOpportunityRecord = Readonly<{
    id: Ulid;
    teamId: Ulid;
    companyId: Ulid;
    contactId: Ulid | null;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type CompanyRelationshipCounts = Readonly<{
    peopleCount?: number;
    opportunitiesCount?: number;
    tasksCount?: number;
    notesCount?: number;
}>;

export type CompanyPersonView = Readonly<{
    record: CompanyPersonRecord;
    customFields: CustomFieldsApiObject;
}>;

export type CompanyOpportunityView = Readonly<{
    record: CompanyOpportunityRecord;
    customFields: CustomFieldsApiObject;
}>;

export type CompanyView = Readonly<{
    record: CompanyRecord;
    customFields: CustomFieldsApiObject;
    creator?: CompanyUserRecord | null;
    accountOwner?: CompanyUserRecord | null;
    people?: readonly CompanyPersonView[];
    opportunities?: readonly CompanyOpportunityView[];
    counts: CompanyRelationshipCounts;
}>;

export type CompanyListPage = Readonly<{
    records: readonly CompanyRecord[];
    total: number;
}>;

export type CompanyListView = Readonly<{
    companies: readonly CompanyView[];
    page: number;
    perPage: number;
    total: number;
}>;

export type CreateCompanyData = Readonly<{
    name: string;
    customFields?: unknown;
}>;

export type UpdateCompanyData = Readonly<{
    name?: string;
    customFields?: unknown;
}>;
