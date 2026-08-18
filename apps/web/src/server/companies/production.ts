import {
    productionApiAccessResolver,
    productionActivityWriter,
    productionCustomFieldsService,
} from "@/server/api/production";

import { DrizzleCompaniesRepository } from "./drizzle-repository";
import type { CompaniesApiDependencies } from "./handler";
import { CompaniesService } from "./service";

export const companiesApiDependencies: CompaniesApiDependencies = {
    auth: productionApiAccessResolver,
    companies: new CompaniesService(
        new DrizzleCompaniesRepository(productionActivityWriter),
        productionCustomFieldsService,
    ),
};
