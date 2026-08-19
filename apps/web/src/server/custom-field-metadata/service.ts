import type { RequestContext } from "@/server/context/request-context";

import type { CustomFieldMetadataRepository } from "./repository";
import type { CustomFieldMetadataPage, CustomFieldMetadataQuery } from "./types";

export class CustomFieldMetadataService {
    public constructor(private readonly repository: CustomFieldMetadataRepository) {}

    public list(
        context: Pick<RequestContext, "teamId">,
        query: CustomFieldMetadataQuery,
    ): Promise<CustomFieldMetadataPage> {
        return this.repository.list(context.teamId, query);
    }
}
