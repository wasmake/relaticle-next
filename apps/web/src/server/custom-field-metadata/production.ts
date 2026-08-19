import { productionApiAccessResolver } from "@/server/api/production";

import { DrizzleCustomFieldMetadataRepository } from "./drizzle-repository";
import type { CustomFieldMetadataApiDependencies } from "./handler";
import { CustomFieldMetadataService } from "./service";

export const customFieldMetadataApiDependencies: CustomFieldMetadataApiDependencies = {
    auth: productionApiAccessResolver,
    customFields: new CustomFieldMetadataService(
        new DrizzleCustomFieldMetadataRepository(),
    ),
};
