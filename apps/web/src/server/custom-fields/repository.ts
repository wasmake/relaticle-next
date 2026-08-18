import type { Ulid } from "@/server/ids";

import type {
    CustomFieldDefinition,
    CustomFieldEntityType,
    CustomFieldOptionPromotion,
    CustomFieldStorageValues,
    CustomFieldValueMutation,
    CustomFieldValueRecord,
} from "./types";

export type CustomFieldUniquenessQuery = Readonly<{
    teamId: Ulid;
    entityType: CustomFieldEntityType;
    entityId: Ulid;
    customFieldId: Ulid;
    values: CustomFieldStorageValues;
}>;

export interface CustomFieldRepository {
    loadActiveDefinitions(
        teamId: Ulid,
        entityType: CustomFieldEntityType,
    ): Promise<readonly CustomFieldDefinition[]>;

    loadValues(
        teamId: Ulid,
        entityType: CustomFieldEntityType,
        entityId: Ulid,
    ): Promise<readonly CustomFieldValueRecord[]>;

    hasConflictingValue(query: CustomFieldUniquenessQuery): Promise<boolean>;

    persistValues(
        mutations: readonly CustomFieldValueMutation[],
        optionPromotions: readonly CustomFieldOptionPromotion[],
    ): Promise<void>;
}
