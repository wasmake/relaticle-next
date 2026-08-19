import { randomUUID } from "node:crypto";

import { ApiNotFoundError, ApiValidationError } from "@/server/api/errors";
import type { CompaniesService } from "@/server/companies/service";
import type { RequestContext } from "@/server/context/request-context";
import { ulidSchema, type Ulid } from "@/server/ids";
import type { NotesService } from "@/server/notes/service";
import type { OpportunitiesService } from "@/server/opportunities/service";
import type { PeopleService } from "@/server/people/service";
import type { TasksService } from "@/server/tasks/service";
import { OAuthError, type OAuthIdentity, type OAuthScope } from "@/server/oauth/types";
import type { OAuthService } from "@/server/oauth/service";

const protocolVersion = "2025-06-18";
const entityTypes = ["company", "people", "opportunity", "task", "note"] as const;
type EntityType = (typeof entityTypes)[number];
const pluralEntity = (entity: EntityType): string =>
    entity === "company"
        ? "companies"
        : entity === "people"
          ? "people"
          : entity === "opportunity"
            ? "opportunities"
            : `${entity}s`;

type JsonRpcId = number | string | null;
type JsonObject = Record<string, unknown>;

export type McpDependencies = Readonly<{
    oauth: Pick<OAuthService, "authenticate">;
    companies: CompaniesService;
    people: PeopleService;
    opportunities: OpportunitiesService;
    tasks: TasksService;
    notes: NotesService;
}>;

type ToolDefinition = Readonly<{
    name: string;
    title: string;
    description: string;
    ability: OAuthScope;
    inputSchema: JsonObject;
}>;

const objectSchema = (
    properties: JsonObject = {},
    required: readonly string[] = [],
): JsonObject => ({
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required }),
    additionalProperties: false,
});

const string = (description: string): JsonObject => ({ type: "string", description });
const idSchema = string("Entity ULID.");
const entitySchema: JsonObject = { type: "string", enum: entityTypes };
const bodySchema: JsonObject = {
    type: "object",
    description: "Fields accepted by the corresponding CRM API resource.",
    additionalProperties: true,
};

const tools: readonly ToolDefinition[] = [
    { name: "whoami", title: "Who am I", description: "Show the authenticated user, workspace, and granted abilities.", ability: "read", inputSchema: objectSchema() },
    { name: "search", title: "Search CRM", description: "Search across companies, people, opportunities, tasks, and notes.", ability: "read", inputSchema: objectSchema({ query: string("Text to search for."), entity_types: { type: "array", items: entitySchema }, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["query"]) },
    { name: "fetch", title: "Fetch CRM entity", description: "Fetch one CRM entity by type and ULID.", ability: "read", inputSchema: objectSchema({ entity_type: entitySchema, id: idSchema }, ["entity_type", "id"]) },
    { name: "crm_summary", title: "CRM summary", description: "Count the main CRM entity types in this workspace.", ability: "read", inputSchema: objectSchema() },
    ...entityTypes.flatMap((entity): readonly ToolDefinition[] => [
        { name: `list_${pluralEntity(entity)}`, title: `List ${entity}`, description: `List ${entity} records.`, ability: "read", inputSchema: objectSchema({ query: string("Optional name or title filter."), limit: { type: "integer", minimum: 1, maximum: 100 } }) },
        { name: `create_${entity}`, title: `Create ${entity}`, description: `Create a ${entity} record.`, ability: "create", inputSchema: objectSchema({ data: bodySchema }, ["data"]) },
        { name: `update_${entity}`, title: `Update ${entity}`, description: `Update a ${entity} record.`, ability: "update", inputSchema: objectSchema({ id: idSchema, data: bodySchema }, ["id", "data"]) },
        { name: `delete_${entity}`, title: `Delete ${entity}`, description: `Delete a ${entity} record.`, ability: "delete", inputSchema: objectSchema({ id: idSchema }, ["id"]) },
    ]),
    { name: "attach_task", title: "Attach task", description: "Attach a task to a company, person, or opportunity.", ability: "update", inputSchema: objectSchema({ task_id: idSchema, entity_type: { type: "string", enum: ["company", "people", "opportunity"] }, entity_id: idSchema }, ["task_id", "entity_type", "entity_id"]) },
    { name: "detach_task", title: "Detach task", description: "Detach a task from a company, person, or opportunity.", ability: "update", inputSchema: objectSchema({ task_id: idSchema, entity_type: { type: "string", enum: ["company", "people", "opportunity"] }, entity_id: idSchema }, ["task_id", "entity_type", "entity_id"]) },
    { name: "attach_note", title: "Attach note", description: "Attach a note to a company, person, or opportunity.", ability: "update", inputSchema: objectSchema({ note_id: idSchema, entity_type: { type: "string", enum: ["company", "people", "opportunity"] }, entity_id: idSchema }, ["note_id", "entity_type", "entity_id"]) },
    { name: "detach_note", title: "Detach note", description: "Detach a note from a company, person, or opportunity.", ability: "update", inputSchema: objectSchema({ note_id: idSchema, entity_type: { type: "string", enum: ["company", "people", "opportunity"] }, entity_id: idSchema }, ["note_id", "entity_type", "entity_id"]) },
];

const schemas: Readonly<Record<EntityType, JsonObject>> = {
    company: objectSchema({ name: string("Company name."), custom_fields: bodySchema }, ["name"]),
    people: objectSchema({ name: string("Person name."), company_id: { type: ["string", "null"] }, custom_fields: bodySchema }, ["name"]),
    opportunity: objectSchema({ name: string("Opportunity name."), company_id: { type: ["string", "null"] }, contact_id: { type: ["string", "null"] }, custom_fields: bodySchema }, ["name"]),
    task: objectSchema({ title: string("Task title."), company_ids: { type: "array", items: idSchema }, people_ids: { type: "array", items: idSchema }, opportunity_ids: { type: "array", items: idSchema }, assignee_ids: { type: "array", items: idSchema }, custom_fields: bodySchema }, ["title"]),
    note: objectSchema({ title: string("Note title."), company_ids: { type: "array", items: idSchema }, people_ids: { type: "array", items: idSchema }, opportunity_ids: { type: "array", items: idSchema }, custom_fields: bodySchema }, ["title"]),
};

const asObject = (value: unknown): JsonObject => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Arguments must be an object.");
    }
    return value as JsonObject;
};

const requiredString = (object: JsonObject, key: string): string => {
    const value = object[key];
    if (typeof value !== "string" || value === "") {
        throw new Error(`${key} must be a non-empty string.`);
    }
    return value;
};

const entityTypeFrom = (value: unknown): EntityType => {
    if (typeof value !== "string" || !entityTypes.includes(value as EntityType)) {
        throw new Error("entity_type is invalid.");
    }
    return value as EntityType;
};

const idFrom = (object: JsonObject, key: string): Ulid => {
    const parsed = ulidSchema.safeParse(object[key]);
    if (!parsed.success) {
        throw new Error(`${key} must be a valid ULID.`);
    }
    return parsed.data;
};

const limitFrom = (value: unknown, maximum = 100): number =>
    typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= maximum
        ? value
        : Math.min(25, maximum);

const listEntity = async (
    dependencies: McpDependencies,
    context: RequestContext,
    entity: EntityType,
    query: string | undefined,
    limit: number,
): Promise<unknown> => {
    if (entity === "company") {
        return dependencies.companies.list(context, { page: 1, perPage: limit, filters: query === undefined ? {} : { name: query }, sorts: [{ field: "created_at", direction: "desc" }], includes: [] });
    }
    if (entity === "people") {
        return dependencies.people.list(context, { pagination: { kind: "page", page: 1 }, perPage: limit, filters: { ...(query === undefined ? {} : { name: query }), customFields: [] }, sorts: [{ field: "created_at", direction: "desc" }], includes: [] });
    }
    if (entity === "opportunity") {
        return dependencies.opportunities.list(context, { page: 1, perPage: limit, filters: { ...(query === undefined ? {} : { name: query }), customFields: [] }, sorts: [{ field: "created_at", direction: "desc" }], includes: [] });
    }
    if (entity === "task") {
        return dependencies.tasks.list(context, { page: 1, perPage: limit, filters: { ...(query === undefined ? {} : { title: query }), customFields: [] }, sorts: [{ field: "created_at", direction: "desc" }], includes: [] });
    }
    return dependencies.notes.list(context, { page: 1, perPage: limit, filters: query === undefined ? {} : { title: query }, sorts: [{ field: "created_at", direction: "desc" }], includes: [] });
};

const fetchEntity = async (
    dependencies: McpDependencies,
    context: RequestContext,
    entity: EntityType,
    id: Ulid,
): Promise<unknown> => {
    if (entity === "company") return dependencies.companies.show(context, id, []);
    if (entity === "people") return dependencies.people.show(context, id, []);
    if (entity === "opportunity") return dependencies.opportunities.show(context, id, []);
    if (entity === "task") return dependencies.tasks.show(context, id, ["companies", "people", "opportunities", "assignees"]);
    return dependencies.notes.show(context, id, ["companies", "people", "opportunities"]);
};

const createEntity = async (dependencies: McpDependencies, context: RequestContext, entity: EntityType, data: JsonObject) => {
    if (entity === "company") return dependencies.companies.create(context, data, []);
    if (entity === "people") return dependencies.people.create(context, data, []);
    if (entity === "opportunity") return dependencies.opportunities.create(context, data, []);
    if (entity === "task") return dependencies.tasks.create(context, data, []);
    return dependencies.notes.create(context, data, []);
};

const updateEntity = async (dependencies: McpDependencies, context: RequestContext, entity: EntityType, id: Ulid, data: JsonObject) => {
    if (entity === "company") return dependencies.companies.update(context, id, data, []);
    if (entity === "people") return dependencies.people.update(context, id, data, []);
    if (entity === "opportunity") return dependencies.opportunities.update(context, id, data, []);
    if (entity === "task") return dependencies.tasks.update(context, id, data, []);
    return dependencies.notes.update(context, id, data, []);
};

const deleteEntity = async (dependencies: McpDependencies, context: RequestContext, entity: EntityType, id: Ulid) => {
    if (entity === "company") await dependencies.companies.delete(context, id);
    else if (entity === "people") await dependencies.people.delete(context, id);
    else if (entity === "opportunity") await dependencies.opportunities.delete(context, id);
    else if (entity === "task") await dependencies.tasks.delete(context, id);
    else await dependencies.notes.delete(context, id);
    return { deleted: true, entity_type: entity, id };
};

type AttachType = "company" | "people" | "opportunity";
const attachTypeFrom = (value: unknown): AttachType => {
    if (value !== "company" && value !== "people" && value !== "opportunity") {
        throw new Error("entity_type is invalid.");
    }
    return value;
};

const relationshipField: Readonly<Record<AttachType, "company_ids" | "people_ids" | "opportunity_ids">> = {
    company: "company_ids",
    people: "people_ids",
    opportunity: "opportunity_ids",
};

const updateAttachment = async (
    dependencies: McpDependencies,
    context: RequestContext,
    kind: "task" | "note",
    ownerId: Ulid,
    entityType: AttachType,
    entityId: Ulid,
    attach: boolean,
) => {
    const include = entityType === "company"
        ? "companies"
        : entityType === "opportunity"
          ? "opportunities"
          : "people";
    const view = kind === "task"
        ? await dependencies.tasks.show(context, ownerId, [include])
        : await dependencies.notes.show(context, ownerId, [include]);
    const related = entityType === "company" ? view.companies : entityType === "people" ? view.people : view.opportunities;
    const ids = (related ?? []).map((item) => item.record.id);
    const next = attach ? [...new Set([...ids, entityId])] : ids.filter((id) => id !== entityId);
    const body = { [relationshipField[entityType]]: next };

    return kind === "task"
        ? dependencies.tasks.update(context, ownerId, body, [include])
        : dependencies.notes.update(context, ownerId, body, [include]);
};

const callTool = async (
    dependencies: McpDependencies,
    identity: OAuthIdentity,
    name: string,
    rawArguments: unknown,
): Promise<unknown> => {
    const definition = tools.find((tool) => tool.name === name);
    if (definition === undefined) throw new Error(`Unknown tool: ${name}`);
    if (!identity.context.credential.scopes.includes(definition.ability)) {
        throw new OAuthError("insufficient_scope", `The ${definition.ability} ability is required.`, 403);
    }

    const args = asObject(rawArguments ?? {});
    if (name === "whoami") {
        return { user: identity.user, workspace: identity.team, abilities: identity.context.credential.scopes };
    }
    if (name === "search") {
        const query = requiredString(args, "query");
        const selected = Array.isArray(args.entity_types)
            ? args.entity_types.map(entityTypeFrom)
            : [...entityTypes];
        const limit = limitFrom(args.limit, 50);
        const results = await Promise.all(selected.map(async (entity) => ({ entity_type: entity, result: await listEntity(dependencies, identity.context, entity, query, limit) })));
        return { query, results };
    }
    if (name === "fetch") {
        return fetchEntity(dependencies, identity.context, entityTypeFrom(args.entity_type), idFrom(args, "id"));
    }
    if (name === "crm_summary") {
        const results = await Promise.all(entityTypes.map((entity) => listEntity(dependencies, identity.context, entity, undefined, 1)));
        return Object.fromEntries(entityTypes.map((entity, index) => [pluralEntity(entity), (results[index] as { total: number }).total]));
    }

    const crud = /^(list|create|update|delete)_(companies|company|people|opportunities|opportunity|tasks|task|notes|note)$/u.exec(name);
    if (crud !== null) {
        const operation = crud[1];
        const rawEntity = crud[2];
        const entity: EntityType = rawEntity === "companies" || rawEntity === "company" ? "company" : rawEntity === "opportunities" || rawEntity === "opportunity" ? "opportunity" : rawEntity === "tasks" || rawEntity === "task" ? "task" : rawEntity === "notes" || rawEntity === "note" ? "note" : "people";
        if (operation === "list") return listEntity(dependencies, identity.context, entity, typeof args.query === "string" ? args.query : undefined, limitFrom(args.limit));
        if (operation === "create") return createEntity(dependencies, identity.context, entity, asObject(args.data));
        if (operation === "update") return updateEntity(dependencies, identity.context, entity, idFrom(args, "id"), asObject(args.data));
        return deleteEntity(dependencies, identity.context, entity, idFrom(args, "id"));
    }

    const attachment = /^(attach|detach)_(task|note)$/u.exec(name);
    if (attachment !== null) {
        return updateAttachment(dependencies, identity.context, attachment[2] as "task" | "note", idFrom(args, `${attachment[2]}_id`), attachTypeFrom(args.entity_type), idFrom(args, "entity_id"), attachment[1] === "attach");
    }
    throw new Error(`Unknown tool: ${name}`);
};

const rpcResult = (id: JsonRpcId, result: unknown): JsonObject => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: JsonRpcId, code: number, message: string, data?: unknown): JsonObject => ({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });

const textToolResult = (value: unknown, isError = false): JsonObject => ({
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: typeof value === "object" && value !== null ? value : { value },
    ...(isError ? { isError: true } : {}),
});

const handleRpc = async (message: JsonObject, identity: OAuthIdentity, dependencies: McpDependencies): Promise<JsonObject | undefined> => {
    const id = (typeof message.id === "string" || typeof message.id === "number" || message.id === null) ? message.id : null;
    const method = typeof message.method === "string" ? message.method : "";
    if (message.jsonrpc !== "2.0" || method === "") return rpcError(id, -32600, "Invalid Request");
    if (message.id === undefined) return undefined;

    if (method === "initialize") {
        return rpcResult(id, { protocolVersion, capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } }, serverInfo: { name: "relaticle-crm", version: "1.0.0" }, instructions: "Use search or crm_summary to orient yourself, then fetch records before changing them." });
    }
    if (method === "ping") return rpcResult(id, {});
    if (method === "tools/list") return rpcResult(id, { tools: tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema })) });
    if (method === "resources/list") return rpcResult(id, { resources: entityTypes.map((entity) => ({ uri: `crm://schema/${entity}`, name: `${entity} schema`, title: `${entity} write schema`, description: `JSON schema for ${entity} create operations.`, mimeType: "application/schema+json" })) });
    if (method === "resources/read") {
        const params = asObject(message.params ?? {});
        const match = /^crm:\/\/schema\/(company|people|opportunity|task|note)$/u.exec(requiredString(params, "uri"));
        if (match?.[1] === undefined) return rpcError(id, -32002, "Resource not found");
        if (!identity.context.credential.scopes.includes("read")) return rpcError(id, -32003, "The read ability is required.");
        const entity = match[1] as EntityType;
        return rpcResult(id, { contents: [{ uri: `crm://schema/${entity}`, mimeType: "application/schema+json", text: JSON.stringify(schemas[entity], null, 2) }] });
    }
    if (method === "prompts/list") return rpcResult(id, { prompts: [{ name: "overview", title: "CRM overview", description: "Create a concise workspace overview with priorities and follow-ups.", arguments: [{ name: "focus", description: "Optional area to emphasize.", required: false }] }] });
    if (method === "prompts/get") {
        const params = asObject(message.params ?? {});
        if (params.name !== "overview") return rpcError(id, -32602, "Unknown prompt");
        const args = typeof params.arguments === "object" && params.arguments !== null ? params.arguments as JsonObject : {};
        const focus = typeof args.focus === "string" ? ` Focus on ${args.focus}.` : "";
        return rpcResult(id, { description: "CRM workspace overview", messages: [{ role: "user", content: { type: "text", text: `Use crm_summary and search to summarize this CRM workspace. Identify active opportunities, overdue or important tasks, relationship gaps, and concrete next actions.${focus} Do not mutate data.` } }] });
    }
    if (method === "tools/call") {
        const params = asObject(message.params ?? {});
        try {
            const value = await callTool(dependencies, identity, requiredString(params, "name"), params.arguments);
            return rpcResult(id, textToolResult(value));
        } catch (error) {
            if (error instanceof OAuthError) return rpcError(id, -32003, error.message, { required_scope: error.message.match(/The (\w+)/u)?.[1] });
            if (error instanceof ApiNotFoundError || error instanceof ApiValidationError || error instanceof Error) return rpcResult(id, textToolResult({ error: error.message }, true));
            throw error;
        }
    }
    return rpcError(id, -32601, "Method not found");
};

const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-expose-headers": "mcp-session-id, www-authenticate",
} as const;

export const handleMcpRequest = async (request: Request, dependencies: McpDependencies): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { ...corsHeaders, allow: "POST, OPTIONS" } });
    const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();
    let identity: OAuthIdentity;
    try {
        identity = await dependencies.oauth.authenticate(request.headers.get("authorization"), requestId);
    } catch (error) {
        if (error instanceof OAuthError) {
            const origin = new URL(request.url).origin;
            return new Response(JSON.stringify({ error: error.code, error_description: error.message }), { status: error.status, headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store", "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="${error.code}"` } });
        }
        throw error;
    }

    let message: unknown;
    try {
        message = await request.json();
    } catch {
        return new Response(JSON.stringify(rpcError(null, -32700, "Parse error")), { status: 200, headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" } });
    }
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
        message = {};
    }
    const response = await handleRpc(message as JsonObject, identity, dependencies);
    return response === undefined
        ? new Response(null, { status: 202, headers: corsHeaders })
        : new Response(JSON.stringify(response), { status: 200, headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "no-store" } });
};
