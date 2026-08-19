import { productionApiAccessResolver } from "@/server/api/production";
import { productionCustomFieldsService } from "@/server/api/production";
import { getQueue } from "@/server/queue/client";
import { companiesApiDependencies } from "@/server/companies/production";
import { notesApiDependencies } from "@/server/notes/production";
import { opportunitiesApiDependencies } from "@/server/opportunities/production";
import { peopleApiDependencies } from "@/server/people/production";
import { tasksApiDependencies } from "@/server/tasks/production";

import { DrizzleCsvEntityPort } from "./drizzle-entity-port";
import { DrizzleCsvJobRepository } from "./drizzle-repository";
import { CsvJobService } from "./service";
import { LocalCsvFileStorage } from "./storage";

export const csvApiDependencies = {
    auth: productionApiAccessResolver,
    jobs: new CsvJobService(
        new DrizzleCsvJobRepository(),
        new DrizzleCsvEntityPort({
            companies: companiesApiDependencies.companies,
            people: peopleApiDependencies.people,
            opportunities: opportunitiesApiDependencies.opportunities,
            tasks: tasksApiDependencies.tasks,
            notes: notesApiDependencies.notes,
        }, productionCustomFieldsService),
        new LocalCsvFileStorage(),
        undefined,
        undefined,
        { add: (name, data, options) => getQueue("imports").add(name, data, options) },
    ),
};
