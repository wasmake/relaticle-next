import { companiesApiDependencies } from "@/server/companies/production";
import { notesApiDependencies } from "@/server/notes/production";
import { opportunitiesApiDependencies } from "@/server/opportunities/production";
import { peopleApiDependencies } from "@/server/people/production";
import { tasksApiDependencies } from "@/server/tasks/production";
import { productionOAuthService } from "@/server/oauth/production";

import type { McpDependencies } from "./server";

export const productionMcpDependencies: McpDependencies = {
    oauth: productionOAuthService,
    companies: companiesApiDependencies.companies,
    people: peopleApiDependencies.people,
    opportunities: opportunitiesApiDependencies.opportunities,
    tasks: tasksApiDependencies.tasks,
    notes: notesApiDependencies.notes,
};
