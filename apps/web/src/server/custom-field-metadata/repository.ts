import type { Ulid } from "@/server/ids";

import type { CustomFieldMetadataPage, CustomFieldMetadataQuery } from "./types";

export interface CustomFieldMetadataRepository {
    list(teamId: Ulid, query: CustomFieldMetadataQuery): Promise<CustomFieldMetadataPage>;
}
