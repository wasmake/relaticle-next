import type {
    OpportunityCompanyView,
    OpportunityContactView,
    OpportunityListView,
    OpportunityUserRecord,
    OpportunityView,
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

const userResource = (user: OpportunityUserRecord): JsonApiResourceObject => ({
    id: user.id,
    type: "users",
    attributes: {
        name: user.name,
        email: user.email,
    },
});

const companyResource = (
    company: OpportunityCompanyView,
): JsonApiResourceObject => ({
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

const contactResource = (
    contact: OpportunityContactView,
): JsonApiResourceObject => ({
    id: contact.record.id,
    type: "people",
    attributes: {
        name: contact.record.name,
        company_id: contact.record.companyId,
        creation_source: contact.record.creationSource,
        created_at: formatLaravelDate(contact.record.createdAt),
        updated_at: formatLaravelDate(contact.record.updatedAt),
        custom_fields: contact.customFields,
    },
});

const relationshipIdentifier = (
    resource: JsonApiResourceObject | null,
): JsonApiResourceIdentifier | null =>
    resource === null ? null : { id: resource.id, type: resource.type };

const opportunityAttributes = (
    opportunity: OpportunityView,
): Readonly<Record<string, unknown>> => ({
    name: opportunity.record.name,
    company_id: opportunity.record.companyId,
    contact_id: opportunity.record.contactId,
    creation_source: opportunity.record.creationSource,
    created_at: formatLaravelDate(opportunity.record.createdAt),
    updated_at: formatLaravelDate(opportunity.record.updatedAt),
    custom_fields: opportunity.customFields,
    ...(opportunity.counts.tasksCount === undefined
        ? {}
        : { tasks_count: opportunity.counts.tasksCount }),
    ...(opportunity.counts.notesCount === undefined
        ? {}
        : { notes_count: opportunity.counts.notesCount }),
});

const opportunityRelationships = (
    opportunity: OpportunityView,
): Readonly<Record<string, unknown>> => ({
    ...(Object.hasOwn(opportunity, "creator")
        ? {
              creator: {
                  data: relationshipIdentifier(
                      opportunity.creator === undefined ||
                          opportunity.creator === null
                          ? null
                          : userResource(opportunity.creator),
                  ),
              },
          }
        : {}),
    ...(Object.hasOwn(opportunity, "company")
        ? {
              company: {
                  data: relationshipIdentifier(
                      opportunity.company === undefined ||
                          opportunity.company === null
                          ? null
                          : companyResource(opportunity.company),
                  ),
              },
          }
        : {}),
    ...(Object.hasOwn(opportunity, "contact")
        ? {
              contact: {
                  data: relationshipIdentifier(
                      opportunity.contact === undefined ||
                          opportunity.contact === null
                          ? null
                          : contactResource(opportunity.contact),
                  ),
              },
          }
        : {}),
});

const opportunityResource = (
    opportunity: OpportunityView,
): JsonApiResourceObject => {
    const relationships = opportunityRelationships(opportunity);

    return {
        id: opportunity.record.id,
        type: "opportunities",
        attributes: opportunityAttributes(opportunity),
        ...(Object.keys(relationships).length === 0 ? {} : { relationships }),
    };
};

const includedResources = (
    opportunities: readonly OpportunityView[],
): readonly JsonApiResourceObject[] => {
    const included = new Map<string, JsonApiResourceObject>();

    for (const opportunity of opportunities) {
        if (opportunity.creator !== undefined && opportunity.creator !== null) {
            const resource = userResource(opportunity.creator);
            included.set(`${resource.type}:${resource.id}`, resource);
        }

        if (opportunity.company !== undefined && opportunity.company !== null) {
            const resource = companyResource(opportunity.company);
            included.set(`${resource.type}:${resource.id}`, resource);
        }

        if (opportunity.contact !== undefined && opportunity.contact !== null) {
            const resource = contactResource(opportunity.contact);
            included.set(`${resource.type}:${resource.id}`, resource);
        }
    }

    return [...included.values()];
};

export const opportunityDocument = (opportunity: OpportunityView): unknown => {
    const included = includedResources([opportunity]);

    return {
        data: opportunityResource(opportunity),
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

export const opportunityCollectionDocument = (
    result: OpportunityListView,
    requestUrl: URL,
): unknown => {
    const included = includedResources(result.opportunities);
    const lastPage = Math.max(1, Math.ceil(result.total / result.perPage));
    const offset = (result.page - 1) * result.perPage;
    const count = result.opportunities.length;
    const path = `${requestUrl.origin}${requestUrl.pathname}`;

    return {
        data: result.opportunities.map(opportunityResource),
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
