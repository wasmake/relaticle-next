import type { RequestContext } from "@/server/context/request-context";
import { opportunitiesApiDependencies } from "@/server/opportunities/production";
import { parseOpportunityListQuery } from "@/server/opportunities/query";
import { tasksApiDependencies } from "@/server/tasks/production";
import { parseTaskListQuery } from "@/server/tasks/query";
import { orderedActiveIds } from "@/server/browser-crm/service";

import { loadCrmCustomFields } from "./_crm-data";

export type BoardBadge = Readonly<{ label: string; tone: "danger" | "gray" | "success" }>;
export type BoardCard = Readonly<{
    id: string;
    title: string;
    description: string;
    detail: string;
    badges: readonly BoardBadge[];
    assignees: readonly string[];
    optionId: string;
}>;
export type BoardData = Readonly<{
    resource: "opportunities" | "tasks";
    fieldCode: string;
    columns: readonly Readonly<{ id: string; label: string; color?: string; cards: readonly BoardCard[] }>[];
}>;

const queryUrl = (includes: string): URL => {
    const url = new URL("http://browser.local/api?page=1&per_page=100");
    url.searchParams.set("include", includes);
    return url;
};

const choice = (value: unknown): Readonly<{ id: string; label: string }> | undefined =>
    typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
        ? { id: value.id, label: "label" in value ? String(value.label) : "" }
        : undefined;

const textValue = (value: unknown): string => typeof value === "string" ? value.replace(/<[^>]+>/gu, "").trim() : "";
const dateValue = (value: unknown): Date | undefined => {
    if (typeof value !== "string") return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
};
const dateBadge = (value: unknown, task: boolean): BoardBadge | undefined => {
    const date = dateValue(value);
    if (date === undefined) return undefined;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((target.getTime() - start.getTime()) / 86_400_000);
    const label = days < 0
        ? `${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", ...(task ? { year: "numeric" } : {}) }).format(date)} (Overdue)`
        : days === 0 ? (task ? "Due Today" : "Closes Today")
            : days === 1 ? (task ? "Due Tomorrow" : "Closes Tomorrow")
                : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", ...(task ? { year: "numeric" } : {}) }).format(date);
    return { label, tone: days < 0 ? "danger" : "gray" };
};
const currencyBadge = (value: unknown): BoardBadge | undefined => {
    const amount = typeof value === "number" ? value : typeof value === "string" && value !== "" ? Number(value) : Number.NaN;
    return Number.isFinite(amount) ? { label: new Intl.NumberFormat("en", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount), tone: "success" } : undefined;
};

export const loadBoardData = async (context: RequestContext, resource: "opportunities" | "tasks"): Promise<BoardData> => {
    const [fields, orderedIds] = await Promise.all([loadCrmCustomFields(context, resource), orderedActiveIds(context.teamId, resource)]);
    const preferredCode = resource === "opportunities" ? "stage" : "status";
    const field = fields.find((candidate) => candidate.code.toLowerCase() === preferredCode) ?? fields.find((candidate) => candidate.type === "select");
    const options = field?.options ?? [];
    const rank = new Map(orderedIds.map((id, index) => [id, index]));
    let cards: readonly BoardCard[];

    if (resource === "opportunities") {
        const result = await opportunitiesApiDependencies.opportunities.list(context, parseOpportunityListQuery(queryUrl("company")));
        cards = result.opportunities.map(({ company, customFields, record }) => {
            const amount = currencyBadge(customFields.amount);
            const closeDate = dateBadge(customFields.close_date, false);
            return {
                id: record.id,
                title: record.name,
                description: "",
                detail: company?.record.name ?? "",
                badges: [amount, closeDate].filter((badge): badge is BoardBadge => badge !== undefined),
                assignees: [],
                optionId: field === undefined ? "unassigned" : choice(customFields[field.code])?.id ?? "unassigned",
            };
        });
    } else {
        const result = await tasksApiDependencies.tasks.list(context, parseTaskListQuery(queryUrl("assignees")));
        cards = result.tasks.map(({ assignees, customFields, record }) => {
            const priority = choice(customFields.priority);
            const dueDate = dateBadge(customFields.due_date, true);
            return {
                id: record.id,
                title: record.title,
                description: textValue(customFields.description).slice(0, 100),
                detail: "",
                badges: [priority === undefined ? undefined : { label: priority.label, tone: "gray" as const }, dueDate].filter((badge): badge is BoardBadge => badge !== undefined),
                assignees: assignees?.map(({ name }) => name) ?? [],
                optionId: field === undefined ? "unassigned" : choice(customFields[field.code])?.id ?? "unassigned",
            };
        });
    }

    cards = [...cards].sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER));
    const columns = options.length === 0
        ? [{ id: "unassigned", label: `Add a ${preferredCode} select field` }]
        : options.map(({ color, id, label }) => ({ id, label, ...(color === undefined ? {} : { color }) }));
    return { resource, fieldCode: field?.code ?? "", columns: columns.map((column) => ({ ...column, cards: cards.filter((card) => card.optionId === column.id) })) };
};
