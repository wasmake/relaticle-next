import { describe, expect, it, vi } from "vitest";

import { createRequestContext } from "@/server/context/request-context";
import type { Ulid } from "@/server/ids";
import { handleMcpRequest, type McpDependencies } from "@/server/mcp/server";
import { OAuthError, type OAuthIdentity } from "@/server/oauth/types";

const userId = "01ARZ3NDEKTSV4RRFFQ69G5FAV" as Ulid;
const teamId = "01ARZ3NDEKTSV4RRFFQ69G5FAW" as Ulid;
const taskId = "01ARZ3NDEKTSV4RRFFQ69G5FAX" as Ulid;
const entityId = "01ARZ3NDEKTSV4RRFFQ69G5FAY" as Ulid;

const identity = (scopes = ["read", "create", "update", "delete"]): OAuthIdentity => {
    const context = createRequestContext({ requestId: "request-1", userId, teamId, credential: { kind: "oauth", tokenId: "token", scopes } });
    if (context.credential.kind !== "oauth") throw new Error();
    return { context: { ...context, credential: context.credential }, user: { id: userId, name: "Ada", email: "ada@example.test" }, team: { id: teamId, name: "Acme", slug: "acme" } };
};

const dependencies = (scopes?: string[]): McpDependencies => {
    const total = { total: 2 };
    return {
        oauth: { authenticate: vi.fn().mockResolvedValue(identity(scopes)) },
        companies: {
            list: vi.fn().mockResolvedValue({ ...total, companies: [] }),
            show: vi.fn().mockResolvedValue({ record: { id: entityId, name: "Acme" } }),
            create: vi.fn().mockResolvedValue({ record: { id: entityId, name: "Acme" } }),
            update: vi.fn().mockResolvedValue({ record: { id: entityId, name: "New" } }),
            delete: vi.fn().mockResolvedValue(undefined),
        },
        people: {
            list: vi.fn().mockResolvedValue({ ...total, kind: "page", people: [] }),
            show: vi.fn().mockResolvedValue({ record: { id: entityId } }),
            create: vi.fn(), update: vi.fn(), delete: vi.fn(),
        },
        opportunities: {
            list: vi.fn().mockResolvedValue({ ...total, opportunities: [] }),
            show: vi.fn().mockResolvedValue({ record: { id: entityId } }),
            create: vi.fn(), update: vi.fn(), delete: vi.fn(),
        },
        tasks: {
            list: vi.fn().mockResolvedValue({ ...total, tasks: [] }),
            show: vi.fn().mockResolvedValue({ record: { id: taskId }, companies: [], people: [], opportunities: [], assignees: [] }),
            create: vi.fn(), update: vi.fn().mockResolvedValue({ record: { id: taskId } }), delete: vi.fn(),
        },
        notes: {
            list: vi.fn().mockResolvedValue({ ...total, notes: [] }),
            show: vi.fn().mockResolvedValue({ record: { id: taskId }, companies: [], people: [], opportunities: [] }),
            create: vi.fn(), update: vi.fn(), delete: vi.fn(),
        },
    } as unknown as McpDependencies;
};

const rpc = (method: string, params?: unknown, id: number | undefined = 1) =>
    new Request("https://crm.example.test/mcp", {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, ...(params === undefined ? {} : { params }) }),
    });

describe("MCP JSON-RPC endpoint", () => {
    it("initializes and advertises tools, schema resources, and the overview prompt", async () => {
        const deps = dependencies();
        const initialized = await handleMcpRequest(rpc("initialize", { protocolVersion: "2025-06-18" }), deps);
        await expect(initialized.json()).resolves.toMatchObject({ result: { protocolVersion: "2025-06-18", serverInfo: { name: "relaticle-crm" } } });

        const listed = await handleMcpRequest(rpc("tools/list"), deps);
        const document = await listed.json() as { result: { tools: Array<{ name: string }> } };
        expect(document.result.tools.map(({ name }) => name)).toEqual(expect.arrayContaining(["whoami", "search", "fetch", "create_company", "attach_task", "crm_summary"]));

        const resources = await handleMcpRequest(rpc("resources/list"), deps);
        await expect(resources.json()).resolves.toMatchObject({ result: { resources: expect.arrayContaining([expect.objectContaining({ uri: "crm://schema/company" })]) } });
        const prompt = await handleMcpRequest(rpc("prompts/get", { name: "overview", arguments: { focus: "pipeline" } }), deps);
        expect(JSON.stringify(await prompt.json())).toContain("Focus on pipeline");
    });

    it("returns identity and enforces abilities before domain calls", async () => {
        const readOnly = dependencies(["read"]);
        const whoami = await handleMcpRequest(rpc("tools/call", { name: "whoami", arguments: {} }), readOnly);
        await expect(whoami.json()).resolves.toMatchObject({ result: { structuredContent: { workspace: { id: teamId }, abilities: ["read"] } } });

        const denied = await handleMcpRequest(rpc("tools/call", { name: "create_company", arguments: { data: { name: "Blocked" } } }), readOnly);
        await expect(denied.json()).resolves.toMatchObject({ error: { code: -32003 } });
        expect(readOnly.companies.create).not.toHaveBeenCalled();
    });

    it("searches across entity services, fetches, creates, and summarizes", async () => {
        const deps = dependencies();
        const searched = await handleMcpRequest(rpc("tools/call", { name: "search", arguments: { query: "Acme", entity_types: ["company", "people"], limit: 5 } }), deps);
        expect((await searched.json() as { result: { structuredContent: { results: unknown[] } } }).result.structuredContent.results).toHaveLength(2);
        expect(deps.companies.list).toHaveBeenCalledWith(expect.objectContaining({ teamId }), expect.objectContaining({ perPage: 5, filters: { name: "Acme" } }));

        await handleMcpRequest(rpc("tools/call", { name: "fetch", arguments: { entity_type: "company", id: entityId } }), deps);
        expect(deps.companies.show).toHaveBeenCalledWith(expect.objectContaining({ teamId }), entityId, []);
        await handleMcpRequest(rpc("tools/call", { name: "create_company", arguments: { data: { name: "New" } } }), deps);
        expect(deps.companies.create).toHaveBeenCalledWith(expect.anything(), { name: "New" }, []);

        const summary = await handleMcpRequest(rpc("tools/call", { name: "crm_summary", arguments: {} }), deps);
        await expect(summary.json()).resolves.toMatchObject({ result: { structuredContent: { companies: 2, people: 2, opportunities: 2, tasks: 2, notes: 2 } } });
    });

    it("attaches and detaches while preserving existing task relationships", async () => {
        const deps = dependencies();
        const existingId = "01ARZ3NDEKTSV4RRFFQ69G5FAZ" as Ulid;
        vi.mocked(deps.tasks.show).mockResolvedValueOnce({ companies: [{ record: { id: existingId } }], people: [], opportunities: [] } as never);
        await handleMcpRequest(rpc("tools/call", { name: "attach_task", arguments: { task_id: taskId, entity_type: "company", entity_id: entityId } }), deps);
        expect(deps.tasks.update).toHaveBeenCalledWith(expect.anything(), taskId, { company_ids: [existingId, entityId] }, ["companies"]);

        vi.mocked(deps.tasks.show).mockResolvedValueOnce({ companies: [{ record: { id: existingId } }, { record: { id: entityId } }], people: [], opportunities: [] } as never);
        await handleMcpRequest(rpc("tools/call", { name: "detach_task", arguments: { task_id: taskId, entity_type: "company", entity_id: entityId } }), deps);
        expect(deps.tasks.update).toHaveBeenLastCalledWith(expect.anything(), taskId, { company_ids: [existingId] }, ["companies"]);
    });

    it("serves schema resources, accepts notifications, and emits bearer challenges", async () => {
        const deps = dependencies();
        const resource = await handleMcpRequest(rpc("resources/read", { uri: "crm://schema/task" }), deps);
        expect(JSON.stringify(await resource.json())).toContain("company_ids");
        const notification = new Request("https://crm.example.test/mcp", {
            method: "POST",
            headers: { authorization: "Bearer token", "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        });
        expect((await handleMcpRequest(notification, deps)).status).toBe(202);

        const rejected = dependencies();
        vi.mocked(rejected.oauth.authenticate).mockRejectedValue(new OAuthError("invalid_token", "Bad token", 401));
        const response = await handleMcpRequest(rpc("initialize"), rejected);
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
    });
});
