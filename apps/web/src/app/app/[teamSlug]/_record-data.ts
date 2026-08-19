import type { CrmResource } from "./_crm-data";
import { entityTypeForResource, loadCrmCustomFields } from "./_crm-data";

import type { RequestContext } from "@/server/context/request-context";
import { companiesApiDependencies } from "@/server/companies/production";
import { getActivityTimeline } from "@/server/activity/reader";
import { notesApiDependencies } from "@/server/notes/production";
import { opportunitiesApiDependencies } from "@/server/opportunities/production";
import { peopleApiDependencies } from "@/server/people/production";
import { tasksApiDependencies } from "@/server/tasks/production";
import type { Ulid } from "@/server/ids";

export type CrmRecordDetail = Readonly<{
    id: string;
    title: string;
    companyId: string | null;
    companyIds: readonly string[];
    contactId: string | null;
    customValues: Readonly<Record<string, unknown>>;
    createdAt: string | null;
    updatedAt: string | null;
}>;

export const loadCrmRecordDetail = async (context: RequestContext, resource: CrmResource, id: Ulid) => {
    let view;
    let relationshipCompanyIds: readonly string[] = [];
    if (resource === "companies") view = await companiesApiDependencies.companies.show(context, id, []);
    else if (resource === "people") view = await peopleApiDependencies.people.show(context, id, []);
    else if (resource === "opportunities") view = await opportunitiesApiDependencies.opportunities.show(context, id, []);
    else if (resource === "tasks") {
        view = await tasksApiDependencies.tasks.show(context, id, ["companies"]);
        relationshipCompanyIds = view.companies?.map((company) => company.record.id) ?? [];
    } else {
        view = await notesApiDependencies.notes.show(context, id, ["companies"]);
        relationshipCompanyIds = view.companies?.map((company) => company.record.id) ?? [];
    }
    const record = view.record;
    const detail: CrmRecordDetail = {
        id: record.id,
        title: "name" in record ? record.name : record.title,
        companyId: "companyId" in record ? record.companyId : (relationshipCompanyIds[0] ?? null),
        companyIds: "companyId" in record ? (record.companyId === null ? [] : [record.companyId]) : relationshipCompanyIds,
        contactId: "contactId" in record ? record.contactId : null,
        customValues: view.customFields,
        createdAt: record.createdAt?.toISOString() ?? null,
        updatedAt: record.updatedAt?.toISOString() ?? null,
    };
    const [customFields, activity] = await Promise.all([
        loadCrmCustomFields(context, resource),
        getActivityTimeline(context.teamId, entityTypeForResource(resource), id),
    ]);
    return { detail, customFields, activity };
};
