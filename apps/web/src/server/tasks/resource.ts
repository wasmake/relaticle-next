import type {
    TaskCompanyView,
    TaskListView,
    TaskOpportunityView,
    TaskPersonView,
    TaskUserRecord,
    TaskView,
} from "./types";

type JsonApiResourceIdentifier = Readonly<{
    id: string;
    type: string;
}>;

type JsonApiResourceObject = JsonApiResourceIdentifier &
    Readonly<{
        attributes: Readonly<Record<string, unknown>>;
        relationships?: Readonly<Record<string, unknown>>;
    }>;

const formatLaravelDate = (value: Date | null): string | null =>
    value === null ? null : value.toISOString().replace(/Z$/u, "000Z");

const userResource = (user: TaskUserRecord): JsonApiResourceObject => ({
    id: user.id,
    type: "users",
    attributes: {
        name: user.name,
        email: user.email,
    },
});

const companyResource = (company: TaskCompanyView): JsonApiResourceObject => ({
    id: company.record.id,
    type: "companies",
    attributes: {
        name: company.record.name,
        creation_source: company.record.creationSource,
        created_at: formatLaravelDate(company.record.createdAt),
        updated_at: formatLaravelDate(company.record.updatedAt),
        custom_fields: company.customFields,
    },
});

const personResource = (person: TaskPersonView): JsonApiResourceObject => ({
    id: person.record.id,
    type: "people",
    attributes: {
        name: person.record.name,
        company_id: person.record.companyId,
        creation_source: person.record.creationSource,
        created_at: formatLaravelDate(person.record.createdAt),
        updated_at: formatLaravelDate(person.record.updatedAt),
        custom_fields: person.customFields,
    },
});

const opportunityResource = (
    opportunity: TaskOpportunityView,
): JsonApiResourceObject => ({
    id: opportunity.record.id,
    type: "opportunities",
    attributes: {
        name: opportunity.record.name,
        company_id: opportunity.record.companyId,
        contact_id: opportunity.record.contactId,
        creation_source: opportunity.record.creationSource,
        created_at: formatLaravelDate(opportunity.record.createdAt),
        updated_at: formatLaravelDate(opportunity.record.updatedAt),
        custom_fields: opportunity.customFields,
    },
});

const identifier = (
    resource: JsonApiResourceObject | null,
): JsonApiResourceIdentifier | null =>
    resource === null ? null : { id: resource.id, type: resource.type };

const taskAttributes = (task: TaskView): Readonly<Record<string, unknown>> => ({
    title: task.record.title,
    creation_source: task.record.creationSource,
    created_at: formatLaravelDate(task.record.createdAt),
    updated_at: formatLaravelDate(task.record.updatedAt),
    custom_fields: task.customFields,
    ...(task.counts.assigneesCount === undefined
        ? {}
        : { assignees_count: task.counts.assigneesCount }),
    ...(task.counts.companiesCount === undefined
        ? {}
        : { companies_count: task.counts.companiesCount }),
    ...(task.counts.peopleCount === undefined
        ? {}
        : { people_count: task.counts.peopleCount }),
    ...(task.counts.opportunitiesCount === undefined
        ? {}
        : { opportunities_count: task.counts.opportunitiesCount }),
});

const taskRelationships = (
    task: TaskView,
): Readonly<Record<string, unknown>> => ({
    ...(Object.hasOwn(task, "creator")
        ? {
              creator: {
                  data: identifier(
                      task.creator === undefined || task.creator === null
                          ? null
                          : userResource(task.creator),
                  ),
              },
          }
        : {}),
    ...(task.assignees === undefined
        ? {}
        : {
              assignees: {
                  data: task.assignees.map((assignee) =>
                      identifier(userResource(assignee)),
                  ),
              },
          }),
    ...(task.companies === undefined
        ? {}
        : {
              companies: {
                  data: task.companies.map((company) =>
                      identifier(companyResource(company)),
                  ),
              },
          }),
    ...(task.people === undefined
        ? {}
        : {
              people: {
                  data: task.people.map((person) =>
                      identifier(personResource(person)),
                  ),
              },
          }),
    ...(task.opportunities === undefined
        ? {}
        : {
              opportunities: {
                  data: task.opportunities.map((opportunity) =>
                      identifier(opportunityResource(opportunity)),
                  ),
              },
          }),
});

const taskResource = (task: TaskView): JsonApiResourceObject => {
    const relationships = taskRelationships(task);

    return {
        id: task.record.id,
        type: "tasks",
        attributes: taskAttributes(task),
        ...(Object.keys(relationships).length === 0 ? {} : { relationships }),
    };
};

const includedResources = (
    tasks: readonly TaskView[],
): readonly JsonApiResourceObject[] => {
    const included = new Map<string, JsonApiResourceObject>();

    for (const task of tasks) {
        const resources = [
            ...(task.creator === undefined || task.creator === null
                ? []
                : [userResource(task.creator)]),
            ...(task.assignees ?? []).map(userResource),
            ...(task.companies ?? []).map(companyResource),
            ...(task.people ?? []).map(personResource),
            ...(task.opportunities ?? []).map(opportunityResource),
        ];

        for (const resource of resources) {
            included.set(`${resource.type}:${resource.id}`, resource);
        }
    }

    return [...included.values()];
};

export const taskDocument = (task: TaskView): unknown => {
    const included = includedResources([task]);

    return {
        data: taskResource(task),
        ...(included.length === 0 ? {} : { included }),
    };
};

const pageUrl = (requestUrl: URL, page: number): string => {
    const url = new URL(requestUrl);
    url.searchParams.set("page", page.toString());

    return url.toString();
};

const paginationElements = (
    requestUrl: URL,
    currentPage: number,
    lastPage: number,
): readonly Readonly<{
    url: string | null;
    label: string;
    active: boolean;
}>[] => {
    const pages =
        lastPage <= 12
            ? Array.from({ length: lastPage }, (_, index) => index + 1)
            : [
                  ...new Set([
                      1,
                      2,
                      currentPage - 2,
                      currentPage - 1,
                      currentPage,
                      currentPage + 1,
                      currentPage + 2,
                      lastPage - 1,
                      lastPage,
                  ]),
              ]
                  .filter((page) => page >= 1 && page <= lastPage)
                  .sort((left, right) => left - right);
    const links: Array<{ url: string | null; label: string; active: boolean }> =
        [
            {
                url:
                    currentPage > 1
                        ? pageUrl(requestUrl, currentPage - 1)
                        : null,
                label: "&laquo; Previous",
                active: false,
            },
        ];
    let previousPage = 0;

    for (const page of pages) {
        if (previousPage !== 0 && page > previousPage + 1) {
            links.push({ url: null, label: "...", active: false });
        }

        links.push({
            url: pageUrl(requestUrl, page),
            label: page.toString(),
            active: page === currentPage,
        });
        previousPage = page;
    }

    links.push({
        url:
            currentPage < lastPage
                ? pageUrl(requestUrl, currentPage + 1)
                : null,
        label: "Next &raquo;",
        active: false,
    });

    return links;
};

export const taskCollectionDocument = (
    result: TaskListView,
    requestUrl: URL,
): unknown => {
    const included = includedResources(result.tasks);
    const lastPage = Math.max(1, Math.ceil(result.total / result.perPage));
    const offset = (result.page - 1) * result.perPage;
    const count = result.tasks.length;
    const path = `${requestUrl.origin}${requestUrl.pathname}`;

    return {
        data: result.tasks.map(taskResource),
        links: {
            first: pageUrl(requestUrl, 1),
            last: pageUrl(requestUrl, lastPage),
            prev: result.page > 1 ? pageUrl(requestUrl, result.page - 1) : null,
            next:
                result.page < lastPage
                    ? pageUrl(requestUrl, result.page + 1)
                    : null,
        },
        meta: {
            current_page: result.page,
            from: count === 0 ? null : offset + 1,
            last_page: lastPage,
            links: paginationElements(requestUrl, result.page, lastPage),
            path,
            per_page: result.perPage,
            to: count === 0 ? null : offset + count,
            total: result.total,
        },
        ...(included.length === 0 ? {} : { included }),
    };
};
