import {
    productionApiAccessResolver,
    productionActivityWriter,
    productionCustomFieldsService,
} from "@/server/api/production";

import { DrizzlePeopleRepository } from "./drizzle-repository";
import type { PeopleApiDependencies } from "./handler";
import { PeopleService } from "./service";

export const peopleApiDependencies: PeopleApiDependencies = {
    auth: productionApiAccessResolver,
    people: new PeopleService(
        new DrizzlePeopleRepository(productionActivityWriter),
        productionCustomFieldsService,
    ),
};
