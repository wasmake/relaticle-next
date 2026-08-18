import type {
    CompanyListView,
    CompanyOpportunityView,
    CompanyPersonView,
    CompanyUserRecord,
    CompanyView,
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

const userResource = (user: CompanyUserRecord): JsonApiResourceObject => ({
    id: user.id,
    type: "users",
    attributes: {
        name: user.name,
        email: user.email,
    },
});

const personResource = (person: CompanyPersonView): JsonApiResourceObject => ({
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
    opportunity: CompanyOpportunityView,
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

const relationshipIdentifier = (
    resource: JsonApiResourceObject | null,
): JsonApiResourceIdentifier | null =>
    resource === null ? null : { id: resource.id, type: resource.type };

const companyAttributes = (
    company: CompanyView,
): Readonly<Record<string, unknown>> => ({
    name: company.record.name,
    creation_source: company.record.creationSource,
    created_at: formatLaravelDate(company.record.createdAt),
    updated_at: formatLaravelDate(company.record.updatedAt),
    custom_fields: company.customFields,
    ...(company.counts.peopleCount === undefined
        ? {}
        : { people_count: company.counts.peopleCount }),
    ...(company.counts.opportunitiesCount === undefined
        ? {}
        : { opportunities_count: company.counts.opportunitiesCount }),
    ...(company.counts.tasksCount === undefined
        ? {}
        : { tasks_count: company.counts.tasksCount }),
    ...(company.counts.notesCount === undefined
        ? {}
        : { notes_count: company.counts.notesCount }),
});

const companyRelationships = (
    company: CompanyView,
): Readonly<Record<string, unknown>> => ({
    ...(Object.hasOwn(company, "creator")
        ? {
              creator: {
                  data: relationshipIdentifier(
                      company.creator === undefined || company.creator === null
                          ? null
                          : userResource(company.creator),
                  ),
              },
          }
        : {}),
    ...(Object.hasOwn(company, "accountOwner")
        ? {
              accountOwner: {
                  data: relationshipIdentifier(
                      company.accountOwner === undefined ||
                          company.accountOwner === null
                          ? null
                          : userResource(company.accountOwner),
                  ),
              },
          }
        : {}),
    ...(company.people === undefined
        ? {}
        : {
              people: {
                  data: company.people.map((person) =>
                      relationshipIdentifier(personResource(person)),
                  ),
              },
          }),
    ...(company.opportunities === undefined
        ? {}
        : {
              opportunities: {
                  data: company.opportunities.map((opportunity) =>
                      relationshipIdentifier(opportunityResource(opportunity)),
                  ),
              },
          }),
});

const companyResource = (company: CompanyView): JsonApiResourceObject => {
    const relationships = companyRelationships(company);

    return {
        id: company.record.id,
        type: "companies",
        attributes: companyAttributes(company),
        ...(Object.keys(relationships).length === 0 ? {} : { relationships }),
    };
};

const includedResources = (
    companies: readonly CompanyView[],
): readonly JsonApiResourceObject[] => {
    const included = new Map<string, JsonApiResourceObject>();

    for (const company of companies) {
        if (company.creator !== undefined && company.creator !== null) {
            const resource = userResource(company.creator);
            included.set(`${resource.type}:${resource.id}`, resource);
        }

        if (company.accountOwner !== undefined && company.accountOwner !== null) {
            const resource = userResource(company.accountOwner);
            included.set(`${resource.type}:${resource.id}`, resource);
        }

        for (const person of company.people ?? []) {
            const resource = personResource(person);
            included.set(`${resource.type}:${resource.id}`, resource);
        }

        for (const opportunity of company.opportunities ?? []) {
            const resource = opportunityResource(opportunity);
            included.set(`${resource.type}:${resource.id}`, resource);
        }
    }

    return [...included.values()];
};

export const companyDocument = (company: CompanyView): unknown => {
    const included = includedResources([company]);

    return {
        data: companyResource(company),
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
): readonly Readonly<{ url: string | null; label: string; active: boolean }>[] => {
    const pages =
        lastPage <= 12
            ? Array.from({ length: lastPage }, (_, index) => index + 1)
            : [...new Set([
                  1,
                  2,
                  currentPage - 2,
                  currentPage - 1,
                  currentPage,
                  currentPage + 1,
                  currentPage + 2,
                  lastPage - 1,
                  lastPage,
              ])]
                  .filter((page) => page >= 1 && page <= lastPage)
                  .sort((left, right) => left - right);
    const links: Array<{ url: string | null; label: string; active: boolean }> = [
        {
            url: currentPage > 1 ? pageUrl(requestUrl, currentPage - 1) : null,
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
        url: currentPage < lastPage ? pageUrl(requestUrl, currentPage + 1) : null,
        label: "Next &raquo;",
        active: false,
    });

    return links;
};

export const companyCollectionDocument = (
    result: CompanyListView,
    requestUrl: URL,
): unknown => {
    const included = includedResources(result.companies);
    const lastPage = Math.max(1, Math.ceil(result.total / result.perPage));
    const offset = (result.page - 1) * result.perPage;
    const count = result.companies.length;
    const path = `${requestUrl.origin}${requestUrl.pathname}`;

    return {
        data: result.companies.map(companyResource),
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
