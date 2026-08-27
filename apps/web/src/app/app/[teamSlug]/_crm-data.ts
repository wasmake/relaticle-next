import { parseCompanyListQuery } from "@/server/companies/query";
import { companiesApiDependencies } from "@/server/companies/production";
import type { RequestContext } from "@/server/context/request-context";
import { parseNoteListQuery } from "@/server/notes/query";
import { notesApiDependencies } from "@/server/notes/production";
import { parseOpportunityListQuery } from "@/server/opportunities/query";
import { opportunitiesApiDependencies } from "@/server/opportunities/production";
import { parsePeopleListQuery } from "@/server/people/query";
import { peopleApiDependencies } from "@/server/people/production";
import { parseTaskListQuery } from "@/server/tasks/query";
import { tasksApiDependencies } from "@/server/tasks/production";

export const crmResources = [
    "companies",
    "people",
    "opportunities",
    "tasks",
    "notes",
] as const;

export type CrmResource = (typeof crmResources)[number];

export type CrmMutationState = Readonly<{
    status: "idle" | "error" | "success";
    message: string;
}>;

export type CrmOption = Readonly<{ id: string; label: string; color?: string }>;

export type CrmCustomField = Readonly<{
    id: string;
    code: string;
    name: string;
    type: string;
    required: boolean;
    visibleInList: boolean;
    options: readonly CrmOption[];
}>;

export type CrmRecord = Readonly<{
    id: string;
    title: string;
    accountOwner: string | null;
    assignees: readonly string[];
    companies: readonly string[];
    company: CrmOption | null;
    creator: string;
    customFields: Readonly<Record<string, unknown>>;
    people: readonly string[];
    createdAt: string | null;
    updatedAt: string | null;
}>;

export type CrmPageData = Readonly<{
    resource: CrmResource;
    title: string;
    description: string;
    fieldLabel: string;
    records: readonly CrmRecord[];
    page: number;
    perPage: number;
    total: number;
    companies: readonly CrmOption[];
    people: readonly CrmOption[];
    customFields: readonly CrmCustomField[];
    search: string;
    sort: string;
}>;

const descriptions: Record<CrmResource, string> = {
    companies: "Organizations your team is building relationships with.",
    people: "Contacts connected to your team's work.",
    opportunities: "Potential work moving through your pipeline.",
    tasks: "The next actions that keep relationships moving.",
    notes: "Shared context captured by your team.",
};

const titleFor = (resource: CrmResource): string =>
    resource[0]?.toUpperCase() + resource.slice(1);

const queryUrl = (
    resource: CrmResource,
    page: number,
    includes: string,
    search: string,
    sort: string,
): URL => {
    const url = new URL("http://browser.local/api");
    url.searchParams.set("page", page.toString());
    url.searchParams.set("per_page", "25");
    url.searchParams.set("sort", sort);

    if (includes !== "") {
        url.searchParams.set("include", includes);
    }
    if (search !== "") {
        url.searchParams.set(`filter[${resource === "tasks" || resource === "notes" ? "title" : "name"}]`, search);
    }

    return url;
};

export const entityTypeForResource = (resource: CrmResource): "company" | "people" | "opportunity" | "task" | "note" =>
    resource === "companies" ? "company" : resource === "opportunities" ? "opportunity" : resource === "tasks" ? "task" : resource === "notes" ? "note" : "people";

const isRequired = (rules: unknown): boolean => {
    if (typeof rules !== "object" || rules === null || Array.isArray(rules)) return false;
    return (rules as Record<string, unknown>).required === true;
};

const listHiddenByDefault = new Set(["linkedin", "phone_number", "description", "body"]);
const isVisibleInList = (code: string, settings: unknown): boolean => {
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
        return !listHiddenByDefault.has(code);
    }
    const values = settings as Readonly<Record<string, unknown>>;
    return values.visible_in_list !== false && values.list_toggleable_hidden !== true;
};

const optionColor = (settings: unknown): string | undefined => {
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return undefined;
    const color = (settings as Readonly<Record<string, unknown>>).color;
    return typeof color === "string" && color !== "" ? color : undefined;
};

export const loadCrmCustomFields = async (context: RequestContext, resource: CrmResource): Promise<readonly CrmCustomField[]> => {
    const { customFieldMetadataApiDependencies } = await import("@/server/custom-field-metadata/production");
    const page = await customFieldMetadataApiDependencies.customFields.list(context, {
        page: 1,
        perPage: 100,
        filters: { entityType: entityTypeForResource(resource), active: true },
    });
    return page.records.map((field) => ({
        id: field.id,
        code: field.code,
        name: field.name,
        type: field.type,
        required: isRequired(field.validationRules),
        visibleInList: isVisibleInList(field.code, field.settings),
        options: field.options.map((option) => {
            const color = optionColor(option.settings);
            return { id: option.id, label: option.name ?? "Untitled option", ...(color === undefined ? {} : { color }) };
        }),
    }));
};

const formatDate = (value: Date | null): string | null =>
    value?.toISOString() ?? null;

const loadCompanyOptions = async (
    context: RequestContext,
): Promise<readonly CrmOption[]> => {
    const result = await companiesApiDependencies.companies.list(
        context,
        parseCompanyListQuery(queryUrl("companies", 1, "", "", "name")),
    );

    return result.companies.map(({ record }) => ({
        id: record.id,
        label: record.name,
    }));
};

const loadPeopleOptions = async (
    context: RequestContext,
): Promise<readonly CrmOption[]> => {
    const result = await peopleApiDependencies.people.list(
        context,
        parsePeopleListQuery(queryUrl("people", 1, "", "", "name")),
    );

    return result.people.map(({ record }) => ({
        id: record.id,
        label: record.name,
    }));
};

export const loadCrmPage = async (
    context: RequestContext,
    resource: CrmResource,
    requestedPage: number,
    search = "",
    requestedSort = "-created_at",
): Promise<CrmPageData> => {
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;
    let records: readonly CrmRecord[];
    let total: number;
    const sort = ["name", "-name", "title", "-title", "created_at", "-created_at", "updated_at", "-updated_at"].includes(requestedSort)
        ? requestedSort
        : "-created_at";

    if (resource === "companies") {
        const result = await companiesApiDependencies.companies.list(
            context,
            parseCompanyListQuery(queryUrl(resource, page, "creator,accountOwner", search, sort.replace("title", "name"))),
        );
        records = result.companies.map(({ accountOwner, creator, customFields, record }) => ({
            id: record.id,
            title: record.name,
            accountOwner: accountOwner?.name ?? null,
            assignees: [],
            companies: [],
            company: null,
            creator: creator?.name ?? "System",
            customFields,
            people: [],
            createdAt: formatDate(record.createdAt),
            updatedAt: formatDate(record.updatedAt),
        }));
        total = result.total;
    } else if (resource === "people") {
        const result = await peopleApiDependencies.people.list(
            context,
            parsePeopleListQuery(queryUrl(resource, page, "company,creator", search, sort.replace("title", "name"))),
        );
        records = result.people.map(({ company, creator, customFields, record }) => ({
            id: record.id,
            title: record.name,
            accountOwner: null,
            assignees: [],
            companies: [],
            company: company === null || company === undefined ? null : { id: company.record.id, label: company.record.name },
            creator: creator?.name ?? "System",
            customFields,
            people: [],
            createdAt: formatDate(record.createdAt),
            updatedAt: formatDate(record.updatedAt),
        }));
        total = result.kind === "page" ? result.total : result.people.length;
    } else if (resource === "opportunities") {
        const result = await opportunitiesApiDependencies.opportunities.list(
            context,
            parseOpportunityListQuery(queryUrl(resource, page, "creator", search, sort.replace("title", "name"))),
        );
        records = result.opportunities.map(({ creator, customFields, record }) => ({
            id: record.id,
            title: record.name,
            accountOwner: null,
            assignees: [],
            companies: [],
            company: null,
            creator: creator?.name ?? "System",
            customFields,
            people: [],
            createdAt: formatDate(record.createdAt),
            updatedAt: formatDate(record.updatedAt),
        }));
        total = result.total;
    } else if (resource === "tasks") {
        const result = await tasksApiDependencies.tasks.list(
            context,
            parseTaskListQuery(queryUrl(resource, page, "creator,assignees", search, sort.replace("name", "title"))),
        );
        records = result.tasks.map(({ assignees, creator, customFields, record }) => ({
            id: record.id,
            title: record.title,
            accountOwner: null,
            assignees: assignees?.map(({ name }) => name) ?? [],
            companies: [],
            company: null,
            creator: creator?.name ?? "System",
            customFields,
            people: [],
            createdAt: formatDate(record.createdAt),
            updatedAt: formatDate(record.updatedAt),
        }));
        total = result.total;
    } else {
        const result = await notesApiDependencies.notes.list(
            context,
            parseNoteListQuery(queryUrl(resource, page, "creator,companies,people", search, sort.replace("name", "title"))),
        );
        records = result.notes.map(({ companies: linkedCompanies, creator, customFields, people: linkedPeople, record }) => ({
            id: record.id,
            title: record.title,
            accountOwner: null,
            assignees: [],
            companies: linkedCompanies?.map(({ record: company }) => company.name) ?? [],
            company: null,
            creator: creator?.name ?? "System",
            customFields,
            people: linkedPeople?.map(({ record: person }) => person.name) ?? [],
            createdAt: formatDate(record.createdAt),
            updatedAt: formatDate(record.updatedAt),
        }));
        total = result.total;
    }

    const [companies, people, customFields] = await Promise.all([
        resource === "people" || resource === "opportunities" || resource === "tasks" || resource === "notes"
            ? loadCompanyOptions(context)
            : [],
        resource === "opportunities" ? loadPeopleOptions(context) : [],
        loadCrmCustomFields(context, resource),
    ]);

    return {
        resource,
        title: titleFor(resource),
        description: descriptions[resource],
        fieldLabel: resource === "tasks" || resource === "notes" ? "Title" : "Name",
        records,
        page,
        perPage: 25,
        total,
        companies,
        people,
        customFields,
        search,
        sort,
    };
};
