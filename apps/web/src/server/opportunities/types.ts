import type { CustomFieldsApiObject } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

export const opportunityIncludes = [
    "creator",
    "company",
    "contact",
    "tasksCount",
    "notesCount",
] as const;

export type OpportunityInclude = (typeof opportunityIncludes)[number];

export const opportunityCountIncludes = ["tasksCount", "notesCount"] as const;

export type OpportunityCountInclude = (typeof opportunityCountIncludes)[number];

export type OpportunitySortField =
    "name" | "created_at" | "updated_at" | string;
export type SortDirection = "asc" | "desc";

export type OpportunitySort = Readonly<{
    field: OpportunitySortField;
    direction: SortDirection;
}>;

export type CustomFieldFilterOperator =
    "eq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "has_any";

export type OpportunityCustomFieldFilter = Readonly<{
    code: string;
    operator: CustomFieldFilterOperator;
    value: string | readonly string[];
}>;

export type OpportunityListQuery = Readonly<{
    page: number;
    perPage: number;
    filters: Readonly<{
        name?: string;
        companyId?: string;
        contactId?: string;
        createdAfter?: string;
        createdBefore?: string;
        staleDays?: number;
        customFields: readonly OpportunityCustomFieldFilter[];
    }>;
    sorts: readonly OpportunitySort[];
    includes: readonly OpportunityInclude[];
}>;

export type OpportunityRecord = Readonly<{
    id: Ulid;
    teamId: Ulid;
    creatorId: Ulid | null;
    companyId: Ulid | null;
    contactId: Ulid | null;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type OpportunityUserRecord = Readonly<{
    id: Ulid;
    name: string;
    email: string;
}>;

export type OpportunityCompanyRecord = Readonly<{
    id: Ulid;
    teamId: Ulid;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type OpportunityContactRecord = Readonly<{
    id: Ulid;
    teamId: Ulid;
    companyId: Ulid | null;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type OpportunityRelationshipCounts = Readonly<{
    tasksCount?: number;
    notesCount?: number;
}>;

export type OpportunityCompanyView = Readonly<{
    record: OpportunityCompanyRecord;
    customFields: CustomFieldsApiObject;
}>;

export type OpportunityContactView = Readonly<{
    record: OpportunityContactRecord;
    customFields: CustomFieldsApiObject;
}>;

export type OpportunityView = Readonly<{
    record: OpportunityRecord;
    customFields: CustomFieldsApiObject;
    creator?: OpportunityUserRecord | null;
    company?: OpportunityCompanyView | null;
    contact?: OpportunityContactView | null;
    counts: OpportunityRelationshipCounts;
}>;

export type OpportunityListPage = Readonly<{
    records: readonly OpportunityRecord[];
    total: number;
}>;

export type OpportunityListView = Readonly<{
    opportunities: readonly OpportunityView[];
    page: number;
    perPage: number;
    total: number;
}>;

export type CreateOpportunityData = Readonly<{
    name: string;
    companyId?: Ulid | null;
    contactId?: Ulid | null;
    customFields?: unknown;
}>;

export type UpdateOpportunityData = Readonly<{
    name?: string;
    companyId?: Ulid | null;
    contactId?: Ulid | null;
    customFields?: unknown;
}>;
