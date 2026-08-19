import type { RequestContext } from "@/server/context/request-context";
import { opportunitiesApiDependencies } from "@/server/opportunities/production";
import { parseOpportunityListQuery } from "@/server/opportunities/query";
import { tasksApiDependencies } from "@/server/tasks/production";
import { parseTaskListQuery } from "@/server/tasks/query";
import { orderedActiveIds } from "@/server/browser-crm/service";

import { loadCrmCustomFields } from "./_crm-data";

export type BoardCard = Readonly<{ id: string; title: string; detail: string; optionId: string }>;
export type BoardData = Readonly<{ resource: "opportunities" | "tasks"; fieldCode: string; columns: readonly Readonly<{ id: string; label: string; cards: readonly BoardCard[] }>[] }>;

const queryUrl = (includes: string): URL => {
    const url = new URL("http://browser.local/api?page=1&per_page=100");
    url.searchParams.set("include", includes);
    return url;
};

const choiceId = (value: unknown): string => typeof value === "object" && value !== null && "id" in value && typeof value.id === "string" ? value.id : "unassigned";

export const loadBoardData = async (context: RequestContext, resource: "opportunities" | "tasks"): Promise<BoardData> => {
    const [fields, orderedIds] = await Promise.all([loadCrmCustomFields(context, resource), orderedActiveIds(context.teamId, resource)]);
    const preferredCode = resource === "opportunities" ? "stage" : "status";
    const field = fields.find((candidate) => candidate.code.toLowerCase() === preferredCode) ?? fields.find((candidate) => candidate.type === "select");
    const options = field?.options ?? [];
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    let cards: BoardCard[];
    if (resource === "opportunities") {
        const result = await opportunitiesApiDependencies.opportunities.list(context, parseOpportunityListQuery(queryUrl("company")));
        cards = result.opportunities.map(({ company, customFields, record }) => ({ id: record.id, title: record.name, detail: company?.record.name ?? "No company", optionId: field === undefined ? "unassigned" : choiceId(customFields[field.code]) }));
    } else {
        const result = await tasksApiDependencies.tasks.list(context, parseTaskListQuery(queryUrl("companiesCount")));
        cards = result.tasks.map(({ counts, customFields, record }) => ({ id: record.id, title: record.title, detail: `${counts.companiesCount ?? 0} linked companies`, optionId: field === undefined ? "unassigned" : choiceId(customFields[field.code]) }));
    }
    cards.sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER));
    const columns = [...options.map((option) => ({ id: option.id, label: option.label })), { id: "unassigned", label: field === undefined ? `Add a ${preferredCode} select field` : `No ${preferredCode}` }];
    return { resource, fieldCode: field?.code ?? "", columns: columns.map((column) => ({ ...column, cards: cards.filter((card) => card.optionId === column.id) })) };
};
