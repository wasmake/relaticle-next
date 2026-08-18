import type {
    NoteCompanyView,
    NoteListView,
    NoteOpportunityView,
    NotePersonView,
    NoteUserRecord,
    NoteView,
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

const userResource = (user: NoteUserRecord): JsonApiResourceObject => ({
    id: user.id,
    type: "users",
    attributes: {
        name: user.name,
        email: user.email,
    },
});

const companyResource = (company: NoteCompanyView): JsonApiResourceObject => ({
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

const personResource = (person: NotePersonView): JsonApiResourceObject => ({
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
    opportunity: NoteOpportunityView,
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

const noteAttributes = (note: NoteView): Readonly<Record<string, unknown>> => ({
    title: note.record.title,
    creation_source: note.record.creationSource,
    created_at: formatLaravelDate(note.record.createdAt),
    updated_at: formatLaravelDate(note.record.updatedAt),
    custom_fields: note.customFields,
    ...(note.counts.companiesCount === undefined
        ? {}
        : { companies_count: note.counts.companiesCount }),
    ...(note.counts.peopleCount === undefined
        ? {}
        : { people_count: note.counts.peopleCount }),
    ...(note.counts.opportunitiesCount === undefined
        ? {}
        : { opportunities_count: note.counts.opportunitiesCount }),
});

const noteRelationships = (
    note: NoteView,
): Readonly<Record<string, unknown>> => ({
    ...(Object.hasOwn(note, "creator")
        ? {
              creator: {
                  data: relationshipIdentifier(
                      note.creator === undefined || note.creator === null
                          ? null
                          : userResource(note.creator),
                  ),
              },
          }
        : {}),
    ...(note.companies === undefined
        ? {}
        : {
              companies: {
                  data: note.companies.map((company) =>
                      relationshipIdentifier(companyResource(company)),
                  ),
              },
          }),
    ...(note.people === undefined
        ? {}
        : {
              people: {
                  data: note.people.map((person) =>
                      relationshipIdentifier(personResource(person)),
                  ),
              },
          }),
    ...(note.opportunities === undefined
        ? {}
        : {
              opportunities: {
                  data: note.opportunities.map((opportunity) =>
                      relationshipIdentifier(opportunityResource(opportunity)),
                  ),
              },
          }),
});

const noteResource = (note: NoteView): JsonApiResourceObject => {
    const relationships = noteRelationships(note);

    return {
        id: note.record.id,
        type: "notes",
        attributes: noteAttributes(note),
        ...(Object.keys(relationships).length === 0 ? {} : { relationships }),
    };
};

const includedResources = (
    notes: readonly NoteView[],
): readonly JsonApiResourceObject[] => {
    const included = new Map<string, JsonApiResourceObject>();

    for (const note of notes) {
        if (note.creator !== undefined && note.creator !== null) {
            const resource = userResource(note.creator);
            included.set(`${resource.type}:${resource.id}`, resource);
        }

        for (const company of note.companies ?? []) {
            const resource = companyResource(company);
            included.set(`${resource.type}:${resource.id}`, resource);
        }

        for (const person of note.people ?? []) {
            const resource = personResource(person);
            included.set(`${resource.type}:${resource.id}`, resource);
        }

        for (const opportunity of note.opportunities ?? []) {
            const resource = opportunityResource(opportunity);
            included.set(`${resource.type}:${resource.id}`, resource);
        }
    }

    return [...included.values()];
};

export const noteDocument = (note: NoteView): unknown => {
    const included = includedResources([note]);

    return {
        data: noteResource(note),
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

export const noteCollectionDocument = (
    result: NoteListView,
    requestUrl: URL,
): unknown => {
    const included = includedResources(result.notes);
    const lastPage = Math.max(1, Math.ceil(result.total / result.perPage));
    const offset = (result.page - 1) * result.perPage;
    const count = result.notes.length;
    const path = `${requestUrl.origin}${requestUrl.pathname}`;

    return {
        data: result.notes.map(noteResource),
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
