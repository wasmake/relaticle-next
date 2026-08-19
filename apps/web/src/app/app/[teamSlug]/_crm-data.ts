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

export type CrmOption = Readonly<{ id: string; label: string }>;

export type CrmCustomField = Readonly<{
    id: string;
    code: string;
    name: string;
    type: string;
    required: boolean;
    options: readonly CrmOption[];
}>;

export type CrmRecord = Readonly<{
    id: string;
    title: string;
    detail: string;
    createdAt: string | null;
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

const queryUrl = (page: number, includes = ""): URL => {
    const url = new URL("http://browser.local/api");
    url.searchParams.set("page", page.toString());
    url.searchParams.set("per_page", "25");

    if (includes !== "") {
        url.searchParams.set("include", includes);
    }

    return url;
};

export const entityTypeForResource = (resource: CrmResource): "company" | "people" | "opportunity" | "task" | "note" =>
    resource === "companies" ? "company" : resource === "opportunities" ? "opportunity" : resource === "tasks" ? "task" : resource === "notes" ? "note" : "people";

const isRequired = (rules: unknown): boolean => {
    if (typeof rules !== "object" || rules === null || Array.isArray(rules)) return false;
    return (rules as Record<string, unknown>).required === true;
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
        options: field.options.map((option) => ({ id: option.id, label: option.name ?? "Untitled option" })),
    }));
};

const formatDate = (value: Date | null): string | null =>
    value?.toISOString() ?? null;

const loadCompanyOptions = async (
    context: RequestContext,
): Promise<readonly CrmOption[]> => {
    const result = await companiesApiDependencies.companies.list(
        context,
        parseCompanyListQuery(queryUrl(1)),
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
        parsePeopleListQuery(queryUrl(1)),
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
): Promise<CrmPageData> => {
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1;
    let records: readonly CrmRecord[];
    let total: number;

    if (resource === "companies") {
        const result = await companiesApiDependencies.companies.list(
            context,
            parseCompanyListQuery(queryUrl(page, "peopleCount,opportunitiesCount")),
        );
        records = result.companies.map(({ counts, record }) => ({
            id: record.id,
            title: record.name,
            detail: `${counts.peopleCount ?? 0} people · ${counts.opportunitiesCount ?? 0} opportunities`,
            createdAt: formatDate(record.createdAt),
        }));
        total = result.total;
    } else if (resource === "people") {
        const result = await peopleApiDependencies.people.list(
            context,
            parsePeopleListQuery(queryUrl(page, "company")),
        );
        records = result.people.map(({ company, record }) => ({
            id: record.id,
            title: record.name,
            detail: company?.record.name ?? "No company",
            createdAt: formatDate(record.createdAt),
        }));
        total = result.kind === "page" ? result.total : result.people.length;
    } else if (resource === "opportunities") {
        const result = await opportunitiesApiDependencies.opportunities.list(
            context,
            parseOpportunityListQuery(queryUrl(page, "company,contact")),
        );
        records = result.opportunities.map(({ company, contact, record }) => ({
            id: record.id,
            title: record.name,
            detail: [company?.record.name, contact?.record.name]
                .filter((value) => value !== undefined)
                .join(" · ") || "Unlinked opportunity",
            createdAt: formatDate(record.createdAt),
        }));
        total = result.total;
    } else if (resource === "tasks") {
        const result = await tasksApiDependencies.tasks.list(
            context,
            parseTaskListQuery(queryUrl(page, "companiesCount,peopleCount,opportunitiesCount")),
        );
        records = result.tasks.map(({ counts, record }) => ({
            id: record.id,
            title: record.title,
            detail: `${(counts.companiesCount ?? 0) + (counts.peopleCount ?? 0) + (counts.opportunitiesCount ?? 0)} linked records`,
            createdAt: formatDate(record.createdAt),
        }));
        total = result.total;
    } else {
        const result = await notesApiDependencies.notes.list(
            context,
            parseNoteListQuery(queryUrl(page, "companiesCount,peopleCount,opportunitiesCount")),
        );
        records = result.notes.map(({ counts, record }) => ({
            id: record.id,
            title: record.title,
            detail: `${(counts.companiesCount ?? 0) + (counts.peopleCount ?? 0) + (counts.opportunitiesCount ?? 0)} linked records`,
            createdAt: formatDate(record.createdAt),
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
    };
};
