import type { Ulid } from "@/server/ids";

export type CustomFieldMetadataFilters = Readonly<{
    entityType?: string;
    type?: string;
    code?: string;
    active: boolean;
}>;

export type CustomFieldMetadataQuery = Readonly<{
    page: number;
    perPage: number;
    filters: CustomFieldMetadataFilters;
}>;

export type CustomFieldMetadataOption = Readonly<{
    id: Ulid;
    name: string | null;
    sortOrder: bigint | null;
    settings: unknown;
}>;

export type CustomFieldMetadataRecord = Readonly<{
    id: Ulid;
    sectionId: Ulid | null;
    code: string;
    name: string;
    type: string;
    lookupType: string | null;
    entityType: string;
    sortOrder: bigint | null;
    validationRules: unknown;
    active: boolean;
    systemDefined: boolean;
    settings: unknown;
    createdAt: Date | null;
    updatedAt: Date | null;
    options: readonly CustomFieldMetadataOption[];
}>;

export type CustomFieldMetadataPage = Readonly<{
    records: readonly CustomFieldMetadataRecord[];
    page: number;
    perPage: number;
    total: number;
}>;
