import {
    productionApiAccessResolver,
    productionActivityWriter,
    productionCustomFieldsService,
} from "@/server/api/production";

import { DrizzleOpportunitiesRepository } from "./drizzle-repository";
import type { OpportunitiesApiDependencies } from "./handler";
import { OpportunitiesService } from "./service";

export const opportunitiesApiDependencies: OpportunitiesApiDependencies = {
    auth: productionApiAccessResolver,
    opportunities: new OpportunitiesService(
        new DrizzleOpportunitiesRepository(productionActivityWriter),
        productionCustomFieldsService,
    ),
};
