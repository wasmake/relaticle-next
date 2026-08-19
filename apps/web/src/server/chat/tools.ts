import { and, desc, eq, ilike, isNull } from "drizzle-orm";

import type { RequestContext } from "@/server/context/request-context";
import { createRequestContext } from "@/server/context/request-context";
import { getDatabase } from "@/server/db/client";
import { companies, notes, opportunities, people, tasks, teams } from "@/server/db/schema";
import { createUlid, ulidSchema } from "@/server/ids";
import type { CompaniesService } from "@/server/companies/service";
import type { NotesService } from "@/server/notes/service";
import type { OpportunitiesService } from "@/server/opportunities/service";
import type { PeopleService } from "@/server/people/service";
import type { TasksService } from "@/server/tasks/service";

import type { ChatRepository } from "./repository";
import type { ChatEntityType, ChatIdentity, ChatReference, PendingActionView, ProviderToolCall, ToolDefinition, ToolResult } from "./types";

export type ToolExecution = Readonly<{ result: ToolResult; proposal?: PendingActionView }>;

export interface ChatToolbox {
    definitions(): readonly ToolDefinition[];
    execute(identity: ChatIdentity, conversationId: string, messageId: string, call: ProviderToolCall): Promise<ToolExecution>;
    approve(identity: ChatIdentity, action: PendingActionView): Promise<Readonly<Record<string, unknown>>>;
    resolveReference(identity: ChatIdentity, type: string, id: string): Promise<ChatReference | undefined>;
    mentions(identity: ChatIdentity, query: string): Promise<readonly ChatReference[]>;
}

const entityTypes = ["company", "people", "opportunity", "task", "note"] as const;
const entitySchema = { type: "string", enum: entityTypes };
const definitions: readonly ToolDefinition[] = [
    { name: "search_crm", description: "Search all CRM records by name or title.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
    { name: "list_records", description: "List recent records of one CRM type.", inputSchema: { type: "object", properties: { entity_type: entitySchema, query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 25 } }, required: ["entity_type"], additionalProperties: false } },
    { name: "get_record", description: "Get one CRM record by its internal id.", inputSchema: { type: "object", properties: { entity_type: entitySchema, id: { type: "string" } }, required: ["entity_type", "id"], additionalProperties: false } },
    { name: "create_record", description: "Propose creating a CRM record. The user must approve it.", inputSchema: { type: "object", properties: { entity_type: entitySchema, fields: { type: "object" } }, required: ["entity_type", "fields"], additionalProperties: false } },
    { name: "update_record", description: "Propose updating a CRM record. The user must approve it.", inputSchema: { type: "object", properties: { entity_type: entitySchema, id: { type: "string" }, fields: { type: "object" } }, required: ["entity_type", "id", "fields"], additionalProperties: false } },
    { name: "delete_record", description: "Propose deleting a CRM record. The user must approve it.", inputSchema: { type: "object", properties: { entity_type: entitySchema, id: { type: "string" } }, required: ["entity_type", "id"], additionalProperties: false } },
];

const entityType = (value: unknown): ChatEntityType => {
    if (typeof value !== "string" || !entityTypes.includes(value as ChatEntityType)) throw new Error("Unknown CRM entity type.");
    return value as ChatEntityType;
};
const fields = (value: unknown): Readonly<Record<string, unknown>> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("fields must be an object.");
    return value as Readonly<Record<string, unknown>>;
};
const text = (value: unknown, name: string, maximum = 255): string => {
    if (typeof value !== "string" || value.trim() === "" || value.trim().length > maximum) throw new Error(`${name} is required and must be at most ${maximum} characters.`);
    return value.trim();
};
const id = (value: unknown): string => ulidSchema.parse(value);
const titleField = (type: ChatEntityType): "name" | "title" => type === "company" || type === "people" || type === "opportunity" ? "name" : "title";
const resourcePath = (type: ChatEntityType): string => type === "company" ? "companies" : type === "opportunity" ? "opportunities" : type === "task" ? "tasks" : type === "note" ? "notes" : "people";
export const chatRecordPath = (workspaceSlug: string, type: ChatEntityType, recordId: string): string => `/app/${workspaceSlug}/${resourcePath(type)}/${recordId}`;
export type ChatCrmServices = Readonly<{
    companies: CompaniesService;
    people: PeopleService;
    opportunities: OpportunitiesService;
    tasks: TasksService;
    notes: NotesService;
}>;

export class DrizzleChatToolbox implements ChatToolbox {
    public constructor(private readonly repository: ChatRepository, private readonly crm: ChatCrmServices, private readonly database = getDatabase(), private readonly now: () => Date = () => new Date()) {}

    public definitions(): readonly ToolDefinition[] { return definitions; }

    public async execute(identity: ChatIdentity, conversationId: string, messageId: string, call: ProviderToolCall): Promise<ToolExecution> {
        let result: unknown;
        let proposal: PendingActionView | undefined;
        if (call.name === "search_crm") {
            result = await this.search(identity, text(call.arguments.query, "query", 100), 5);
        } else if (call.name === "list_records") {
            result = await this.list(identity, entityType(call.arguments.entity_type), typeof call.arguments.query === "string" ? call.arguments.query : "", Math.min(Number(call.arguments.limit ?? 10), 25));
        } else if (call.name === "get_record") {
            const reference = await this.resolveReference(identity, entityType(call.arguments.entity_type), id(call.arguments.id));
            result = reference ?? { error: "Record not found." };
        } else if (["create_record", "update_record", "delete_record"].includes(call.name)) {
            const operation = call.name.split("_")[0] as "create" | "update" | "delete";
            const type = entityType(call.arguments.entity_type);
            const actionData = operation === "create" ? { fields: fields(call.arguments.fields) } : operation === "update" ? { id: id(call.arguments.id), fields: fields(call.arguments.fields) } : { id: id(call.arguments.id) };
            if (operation !== "create" && await this.resolveReference(identity, type, actionData.id as string) === undefined) throw new Error("Record not found.");
            proposal = await this.repository.createProposal({ id: createUlid(), identity, conversationId, messageId, operation, entityType: type, actionData, displayData: { label: operation === "delete" ? (await this.resolveReference(identity, type, actionData.id as string))?.label : String((actionData.fields as Record<string, unknown>)[titleField(type)] ?? type), fields: actionData.fields ?? {} }, expiresAt: new Date(this.now().getTime() + 15 * 60_000) });
            result = { type: "pending_action", pending_action_id: proposal.id, operation, entity_type: type, status: "pending" };
        } else {
            result = { error: "Unknown tool." };
        }
        return { result: { callId: call.id, name: call.name, result }, ...(proposal === undefined ? {} : { proposal }) };
    }

    public async approve(identity: ChatIdentity, action: PendingActionView): Promise<Readonly<Record<string, unknown>>> {
        const type = action.entityType;
        const labelField = titleField(type);
        const context = this.context(identity);
        if (action.operation === "create") {
            const values = fields(action.actionData.fields);
            const label = text(values[labelField], labelField);
            const view = type === "company" ? await this.crm.companies.create(context, values, [], "chat")
                : type === "people" ? await this.crm.people.create(context, values, [], undefined, "chat")
                : type === "opportunity" ? await this.crm.opportunities.create(context, values, [], "chat")
                : type === "task" ? await this.crm.tasks.create(context, values, [], "chat")
                : await this.crm.notes.create(context, values, [], "chat");
            const recordId = view.record.id;
            return { id: recordId, type, label, url: await this.recordUrl(identity, type, recordId) };
        }
        const recordId = id(action.actionData.id);
        if (action.operation === "delete") {
            if (type === "company") await this.crm.companies.delete(context, recordId);
            else if (type === "people") await this.crm.people.delete(context, recordId);
            else if (type === "opportunity") await this.crm.opportunities.delete(context, recordId);
            else if (type === "task") await this.crm.tasks.delete(context, recordId);
            else await this.crm.notes.delete(context, recordId);
            return { id: recordId, type, deleted: true };
        }
        const values = fields(action.actionData.fields);
        const label = values[labelField] === undefined ? undefined : text(values[labelField], labelField);
        if (type === "company") await this.crm.companies.update(context, recordId, values, []);
        else if (type === "people") await this.crm.people.update(context, recordId, values, []);
        else if (type === "opportunity") await this.crm.opportunities.update(context, recordId, values, []);
        else if (type === "task") await this.crm.tasks.update(context, recordId, values, []);
        else await this.crm.notes.update(context, recordId, values, []);
        const reference = await this.resolveReference(identity, type, recordId);
        return { id: recordId, type, label: reference?.label ?? label ?? type, url: await this.recordUrl(identity, type, recordId) };
    }

    public async resolveReference(identity: ChatIdentity, typeValue: string, recordId: string): Promise<ChatReference | undefined> {
        const type = entityType(typeValue);
        const record = await this.find(identity, type, id(recordId));
        return record === undefined ? undefined : { type, id: record.id, label: record.label, url: await this.recordUrl(identity, type, record.id) };
    }

    public async mentions(identity: ChatIdentity, query: string): Promise<readonly ChatReference[]> {
        if (query.trim().length < 2) return [];
        return this.search(identity, query.trim(), 5);
    }

    private async search(identity: ChatIdentity, query: string, limit: number): Promise<readonly ChatReference[]> {
        const nested = await Promise.all(entityTypes.map((type) => this.list(identity, type, query, limit)));
        return nested.flat().slice(0, 20);
    }

    private async list(identity: ChatIdentity, type: ChatEntityType, query: string, limit: number): Promise<readonly ChatReference[]> {
        const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
        const rows = type === "company" ? await this.database.select({ id: companies.id, label: companies.name }).from(companies).where(and(eq(companies.teamId, identity.teamId), isNull(companies.deletedAt), query === "" ? undefined : ilike(companies.name, pattern))).orderBy(desc(companies.updatedAt)).limit(limit)
            : type === "people" ? await this.database.select({ id: people.id, label: people.name }).from(people).where(and(eq(people.teamId, identity.teamId), isNull(people.deletedAt), query === "" ? undefined : ilike(people.name, pattern))).orderBy(desc(people.updatedAt)).limit(limit)
            : type === "opportunity" ? await this.database.select({ id: opportunities.id, label: opportunities.name }).from(opportunities).where(and(eq(opportunities.teamId, identity.teamId), isNull(opportunities.deletedAt), query === "" ? undefined : ilike(opportunities.name, pattern))).orderBy(desc(opportunities.updatedAt)).limit(limit)
            : type === "task" ? await this.database.select({ id: tasks.id, label: tasks.title }).from(tasks).where(and(eq(tasks.teamId, identity.teamId), isNull(tasks.deletedAt), query === "" ? undefined : ilike(tasks.title, pattern))).orderBy(desc(tasks.updatedAt)).limit(limit)
            : await this.database.select({ id: notes.id, label: notes.title }).from(notes).where(and(eq(notes.teamId, identity.teamId), isNull(notes.deletedAt), query === "" ? undefined : ilike(notes.title, pattern))).orderBy(desc(notes.updatedAt)).limit(limit);
        return Promise.all(rows.map(async (row) => ({ ...row, type, url: await this.recordUrl(identity, type, row.id) })));
    }

    private async find(identity: ChatIdentity, type: ChatEntityType, recordId: string): Promise<{ id: string; label: string } | undefined> {
        if (type === "company") return (await this.database.select({ id: companies.id, label: companies.name }).from(companies).where(and(eq(companies.id, recordId), eq(companies.teamId, identity.teamId), isNull(companies.deletedAt))).limit(1))[0];
        if (type === "people") return (await this.database.select({ id: people.id, label: people.name }).from(people).where(and(eq(people.id, recordId), eq(people.teamId, identity.teamId), isNull(people.deletedAt))).limit(1))[0];
        if (type === "opportunity") return (await this.database.select({ id: opportunities.id, label: opportunities.name }).from(opportunities).where(and(eq(opportunities.id, recordId), eq(opportunities.teamId, identity.teamId), isNull(opportunities.deletedAt))).limit(1))[0];
        if (type === "task") return (await this.database.select({ id: tasks.id, label: tasks.title }).from(tasks).where(and(eq(tasks.id, recordId), eq(tasks.teamId, identity.teamId), isNull(tasks.deletedAt))).limit(1))[0];
        return (await this.database.select({ id: notes.id, label: notes.title }).from(notes).where(and(eq(notes.id, recordId), eq(notes.teamId, identity.teamId), isNull(notes.deletedAt))).limit(1))[0];
    }

    private context(identity: ChatIdentity): RequestContext {
        return createRequestContext({ requestId: `chat:${createUlid()}`, userId: identity.userId, teamId: identity.teamId, credential: { kind: "session", sessionId: "chat" } });
    }

    private async recordUrl(identity: ChatIdentity, type: ChatEntityType, recordId: string): Promise<string> {
        const [workspace] = await this.database.select({ slug: teams.slug }).from(teams).where(eq(teams.id, identity.teamId)).limit(1);
        if (workspace === undefined) throw new Error("Workspace not found.");
        return chatRecordPath(workspace.slug, type, recordId);
    }

}

export const identityFromContext = (context: RequestContext): ChatIdentity => ({ teamId: context.teamId, userId: context.userId });
