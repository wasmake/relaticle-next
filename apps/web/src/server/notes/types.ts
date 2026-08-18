import type { CustomFieldsApiObject } from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

export const noteableTypes = ["company", "people", "opportunity"] as const;

export type NoteableType = (typeof noteableTypes)[number];

export const noteIncludes = [
    "creator",
    "companies",
    "people",
    "opportunities",
    "companiesCount",
    "peopleCount",
    "opportunitiesCount",
] as const;

export type NoteInclude = (typeof noteIncludes)[number];

export const noteCountIncludes = [
    "companiesCount",
    "peopleCount",
    "opportunitiesCount",
] as const;

export type NoteCountInclude = (typeof noteCountIncludes)[number];

export type NoteSortField = "title" | "created_at" | "updated_at";
export type SortDirection = "asc" | "desc";

export type NoteSort = Readonly<{
    field: NoteSortField;
    direction: SortDirection;
}>;

export type NoteListQuery = Readonly<{
    page: number;
    perPage: number;
    filters: Readonly<{
        title?: string;
        notableType?: NoteableType;
        notableId?: Ulid;
        createdAfter?: string;
        createdBefore?: string;
    }>;
    sorts: readonly NoteSort[];
    includes: readonly NoteInclude[];
}>;

export type NoteRecord = Readonly<{
    id: Ulid;
    teamId: Ulid;
    creatorId: Ulid | null;
    title: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type NoteUserRecord = Readonly<{
    id: Ulid;
    name: string;
    email: string;
}>;

export type NoteCompanyRecord = Readonly<{
    noteId: Ulid;
    id: Ulid;
    teamId: Ulid;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type NotePersonRecord = Readonly<{
    noteId: Ulid;
    id: Ulid;
    teamId: Ulid;
    companyId: Ulid | null;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type NoteOpportunityRecord = Readonly<{
    noteId: Ulid;
    id: Ulid;
    teamId: Ulid;
    companyId: Ulid | null;
    contactId: Ulid | null;
    name: string;
    creationSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type NoteRelationshipCounts = Readonly<{
    companiesCount?: number;
    peopleCount?: number;
    opportunitiesCount?: number;
}>;

export type NoteCompanyView = Readonly<{
    record: NoteCompanyRecord;
    customFields: CustomFieldsApiObject;
}>;

export type NotePersonView = Readonly<{
    record: NotePersonRecord;
    customFields: CustomFieldsApiObject;
}>;

export type NoteOpportunityView = Readonly<{
    record: NoteOpportunityRecord;
    customFields: CustomFieldsApiObject;
}>;

export type NoteView = Readonly<{
    record: NoteRecord;
    customFields: CustomFieldsApiObject;
    creator?: NoteUserRecord | null;
    companies?: readonly NoteCompanyView[];
    people?: readonly NotePersonView[];
    opportunities?: readonly NoteOpportunityView[];
    counts: NoteRelationshipCounts;
}>;

export type NoteListPage = Readonly<{
    records: readonly NoteRecord[];
    total: number;
}>;

export type NoteListView = Readonly<{
    notes: readonly NoteView[];
    page: number;
    perPage: number;
    total: number;
}>;

export type NoteRelationshipSyncs = Readonly<
    Partial<Record<NoteableType, readonly Ulid[]>>
>;

export type CreateNoteData = Readonly<{
    title: string;
    relationships: NoteRelationshipSyncs;
    customFields?: unknown;
}>;

export type UpdateNoteData = Readonly<{
    title?: string;
    relationships: NoteRelationshipSyncs;
    customFields?: unknown;
}>;
