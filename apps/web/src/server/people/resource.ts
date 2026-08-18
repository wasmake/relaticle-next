import type {
    PeopleCompanyView,
    PeopleCursorListView,
    PeopleListView,
    PeoplePageListView,
    PeopleSparseField,
    PeopleUserRecord,
    PeopleView,
} from "./types";

type JsonApiResourceIdentifier = Readonly<{
    id: string;
    type: string;
}>;

type JsonApiResourceObject = JsonApiResourceIdentifier &
    Readonly<{
        attributes?: Readonly<Record<string, unknown>>;
        relationships?: Readonly<Record<string, unknown>>;
    }>;

const formatLaravelDate = (value: Date | null): string | null =>
    value === null ? null : value.toISOString().replace(/Z$/u, "000Z");

const userResource = (user: PeopleUserRecord): JsonApiResourceObject => ({
    id: user.id,
    type: "users",
    attributes: {
        name: user.name,
        email: user.email,
    },
});

const companyResource = (
    company: PeopleCompanyView,
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

const hasSparseField = (
    person: PeopleView,
    field: PeopleSparseField,
): boolean => person.fields === undefined || person.fields.includes(field);

const peopleAttributes = (
    person: PeopleView,
): Readonly<Record<string, unknown>> => ({
    ...(hasSparseField(person, "name") ? { name: person.record.name } : {}),
    ...(hasSparseField(person, "company_id")
        ? { company_id: person.record.companyId }
        : {}),
    ...(person.fields === undefined
        ? { creation_source: person.record.creationSource }
        : {}),
    ...(hasSparseField(person, "created_at")
        ? { created_at: formatLaravelDate(person.record.createdAt) }
        : {}),
    ...(hasSparseField(person, "updated_at")
        ? { updated_at: formatLaravelDate(person.record.updatedAt) }
        : {}),
    ...(person.fields === undefined
        ? { custom_fields: person.customFields }
        : {}),
    ...(person.counts.tasksCount === undefined || person.fields !== undefined
        ? {}
        : { tasks_count: person.counts.tasksCount }),
    ...(person.counts.notesCount === undefined || person.fields !== undefined
        ? {}
        : { notes_count: person.counts.notesCount }),
});

const relationshipIdentifier = (
    resource: JsonApiResourceObject | null,
): JsonApiResourceIdentifier | null =>
    resource === null ? null : { id: resource.id, type: resource.type };

const peopleRelationships = (
    person: PeopleView,
): Readonly<Record<string, unknown>> => ({
    ...(Object.hasOwn(person, "creator")
        ? {
              creator: {
                  data: relationshipIdentifier(
                      person.creator === undefined || person.creator === null
                          ? null
                          : userResource(person.creator),
                  ),
              },
          }
        : {}),
    ...(Object.hasOwn(person, "company")
        ? {
              company: {
                  data: relationshipIdentifier(
                      person.company === undefined || person.company === null
                          ? null
                          : companyResource(person.company),
                  ),
              },
          }
        : {}),
});

const peopleResource = (person: PeopleView): JsonApiResourceObject => {
    const attributes = peopleAttributes(person);
    const relationships = peopleRelationships(person);

    return {
        id: person.record.id,
        type: "people",
        ...(Object.keys(attributes).length === 0 ? {} : { attributes }),
        ...(Object.keys(relationships).length === 0 ? {} : { relationships }),
    };
};

const includedResources = (
    people: readonly PeopleView[],
): readonly JsonApiResourceObject[] => {
    const included = new Map<string, JsonApiResourceObject>();

    for (const person of people) {
        if (person.creator !== undefined && person.creator !== null) {
            const resource = userResource(person.creator);
            included.set(`${resource.type}:${resource.id}`, resource);
        }

        if (person.company !== undefined && person.company !== null) {
            const resource = companyResource(person.company);
            included.set(`${resource.type}:${resource.id}`, resource);
        }
    }

    return [...included.values()];
};

export const peopleDocument = (person: PeopleView): unknown => {
    const included = includedResources([person]);

    return {
        data: peopleResource(person),
        ...(included.length === 0 ? {} : { included }),
    };
};

const pageUrl = (requestUrl: URL, page: number): string => {
    const url = new URL(requestUrl);
    url.searchParams.delete("cursor");
    url.searchParams.set("page", page.toString());

    return url.toString();
};

const cursorUrl = (requestUrl: URL, cursor: string): string => {
    const url = new URL(requestUrl);
    url.searchParams.delete("page");
    url.searchParams.set("cursor", cursor);

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

const pageCollectionDocument = (
    result: PeoplePageListView,
    requestUrl: URL,
): unknown => {
    const included = includedResources(result.people);
    const lastPage = Math.max(1, Math.ceil(result.total / result.perPage));
    const offset = (result.page - 1) * result.perPage;
    const count = result.people.length;
    const path = `${requestUrl.origin}${requestUrl.pathname}`;

    return {
        data: result.people.map(peopleResource),
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

const cursorCollectionDocument = (
    result: PeopleCursorListView,
    requestUrl: URL,
): unknown => {
    const included = includedResources(result.people);
    const path = `${requestUrl.origin}${requestUrl.pathname}`;

    return {
        data: result.people.map(peopleResource),
        links: {
            first: null,
            last: null,
            prev:
                result.previousCursor === null
                    ? null
                    : cursorUrl(requestUrl, result.previousCursor),
            next:
                result.nextCursor === null
                    ? null
                    : cursorUrl(requestUrl, result.nextCursor),
        },
        meta: {
            path,
            per_page: result.perPage,
            next_cursor: result.nextCursor,
            prev_cursor: result.previousCursor,
        },
        ...(included.length === 0 ? {} : { included }),
    };
};

export const peopleCollectionDocument = (
    result: PeopleListView,
    requestUrl: URL,
): unknown =>
    result.kind === "cursor"
        ? cursorCollectionDocument(result, requestUrl)
        : pageCollectionDocument(result, requestUrl);
