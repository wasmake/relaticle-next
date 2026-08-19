import { describe, expect, it } from "vitest";

import type { ApiAccessResult } from "@/server/api/access";
import { apiAccessFromHttpAuthResult, type ApiAccessResolver } from "@/server/api/http";
import { verifySanctumTokenSecret } from "@/server/auth/compatibility/sanctum";
import type { HttpAuthResult } from "@/server/auth/http";
import { createRequestContext, type ApiAbility, type RequestContext } from "@/server/context/request-context";
import type { PersonalAccessTokensRepository } from "@/server/personal-access-tokens/repository";
import {
    handlePersonalAccessTokenRequest,
    handlePersonalAccessTokensCollectionRequest,
} from "@/server/personal-access-tokens/handler";
import { PersonalAccessTokensService } from "@/server/personal-access-tokens/service";
import type {
    CreatePersonalAccessTokenInput,
    PersonalAccessTokenView,
} from "@/server/personal-access-tokens/types";
import { ulidSchema, type Ulid } from "@/server/ids";

const ulid = (sequence: number): Ulid =>
    ulidSchema.parse(`01J${sequence.toString().padStart(23, "0")}`);
const userId = ulid(10);
const teamId = ulid(11);
const now = new Date("2026-08-19T12:00:00.000Z");

const context = (abilities: readonly ApiAbility[] | null = null): RequestContext =>
    createRequestContext({
        requestId: "request-1",
        userId,
        teamId,
        credential:
            abilities === null
                ? { kind: "session", sessionId: "session-1" }
                : { kind: "personal_access_token", tokenId: "9", abilities },
    });

const authentication = (requestContext: RequestContext = context()): HttpAuthResult => ({
    ok: true,
    context: requestContext,
    user: { id: userId, name: "Ada", email: "ada@example.test" },
    team: {
        id: teamId,
        name: "Analytical Engines",
        slug: "analytical-engines",
        personalTeam: false,
    },
});

class StaticAuth implements ApiAccessResolver {
    public constructor(private readonly result: HttpAuthResult) {}
    public async resolve(): Promise<ApiAccessResult> {
        return apiAccessFromHttpAuthResult(this.result);
    }
}

class InMemoryTokens implements PersonalAccessTokensRepository {
    public readonly records: PersonalAccessTokenView[] = [];
    public creates: CreatePersonalAccessTokenInput[] = [];
    public listCalls: { userId: Ulid; teamId: Ulid }[] = [];
    public deleteCalls: { userId: Ulid; teamId: Ulid; tokenId: string }[] = [];
    private sequence = 40;

    public async list(requestedUserId: Ulid, requestedTeamId: Ulid) {
        this.listCalls.push({ userId: requestedUserId, teamId: requestedTeamId });
        return this.records;
    }

    public async create(input: CreatePersonalAccessTokenInput) {
        this.creates.push(input);
        const token: PersonalAccessTokenView = {
            id: String(++this.sequence),
            name: input.name,
            abilities: input.abilities,
            lastUsedAt: null,
            expiresAt: input.expiresAt,
            createdAt: input.occurredAt,
            updatedAt: input.occurredAt,
        };
        this.records.push(token);
        return token;
    }

    public async delete(requestedUserId: Ulid, requestedTeamId: Ulid, tokenId: string) {
        this.deleteCalls.push({ userId: requestedUserId, teamId: requestedTeamId, tokenId });
        const index = this.records.findIndex((token) => token.id === tokenId);
        if (index === -1) return false;
        this.records.splice(index, 1);
        return true;
    }
}

const setup = (authContext: RequestContext = context()) => {
    const repository = new InMemoryTokens();
    const service = new PersonalAccessTokensService(
        repository,
        () => now,
        () => "generated-secret",
    );
    return {
        repository,
        service,
        dependencies: { auth: new StaticAuth(authentication(authContext)), tokens: service },
    };
};

describe("personal access token API", () => {
    it("creates a team-bound Sanctum token with a hashed secret, abilities, and expiration", async () => {
        const { dependencies, repository } = setup();
        const response = await handlePersonalAccessTokensCollectionRequest(
            new Request("https://crm.example.test/api/v1/personal-access-tokens", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "sec-fetch-site": "same-origin",
                },
                body: JSON.stringify({
                    name: "Automation",
                    abilities: ["read", "create"],
                    expires_at: "2026-09-01T00:00:00.000Z",
                }),
            }),
            dependencies,
        );

        expect(response.status).toBe(201);
        expect(repository.creates[0]).toMatchObject({
            userId,
            teamId,
            name: "Automation",
            abilities: ["read", "create"],
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            occurredAt: now,
        });
        expect(repository.creates[0]?.tokenHash).not.toBe("generated-secret");
        expect(verifySanctumTokenSecret("generated-secret", repository.creates[0]?.tokenHash ?? "")).toBe(true);
        await expect(response.json()).resolves.toMatchObject({
            data: { id: "41", attributes: { name: "Automation", abilities: ["read", "create"] } },
            plain_text_token: "41|generated-secret",
        });
    });

    it("defaults to Sanctum wildcard abilities and never returns a stored secret on list", async () => {
        const { dependencies, repository } = setup();
        await handlePersonalAccessTokensCollectionRequest(
            new Request("https://crm.example.test/api/v1/personal-access-tokens", {
                method: "POST",
                headers: { "sec-fetch-site": "same-origin" },
                body: JSON.stringify({ name: "Default" }),
            }),
            dependencies,
        );
        const response = await handlePersonalAccessTokensCollectionRequest(
            new Request("https://crm.example.test/api/v1/personal-access-tokens"),
            dependencies,
        );
        const body = await response.json() as { data: unknown[]; plain_text_token?: string };

        expect(response.status).toBe(200);
        expect(repository.creates[0]?.abilities).toEqual(["*"]);
        expect(repository.listCalls).toEqual([{ userId, teamId }]);
        expect(body.data).toHaveLength(1);
        expect(body).not.toHaveProperty("plain_text_token");
        expect(JSON.stringify(body)).not.toContain("generated-secret");
        expect(JSON.stringify(body)).not.toContain(repository.creates[0]?.tokenHash);
    });

    it.each([
        [{}, "name"],
        [{ name: "Bad", abilities: [] }, "abilities"],
        [{ name: "Bad", abilities: ["admin"] }, "abilities"],
        [{ name: "Bad", abilities: ["*", "read"] }, "abilities"],
        [{ name: "Bad", expires_at: "2026-08-19T11:59:59.000Z" }, "expires_at"],
        [{ name: "Bad", expires_at: "not-a-date" }, "expires_at"],
    ])("validates create payload %#", async (body, errorPath) => {
        const { dependencies, repository } = setup();
        const response = await handlePersonalAccessTokensCollectionRequest(
            new Request("https://crm.example.test/api/v1/personal-access-tokens", {
                method: "POST",
                headers: { "sec-fetch-site": "same-origin" },
                body: JSON.stringify(body),
            }),
            dependencies,
        );
        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toMatchObject({ errors: { [errorPath]: expect.any(Array) } });
        expect(repository.creates).toEqual([]);
    });

    it("prevents a personal token from granting abilities it does not possess", async () => {
        const { dependencies, repository } = setup(context(["create"]));
        const response = await handlePersonalAccessTokensCollectionRequest(
            new Request("https://crm.example.test/api/v1/personal-access-tokens", {
                method: "POST",
                headers: { "sec-fetch-site": "same-origin" },
                body: JSON.stringify({ name: "Escalation", abilities: ["read"] }),
            }),
            dependencies,
        );
        expect(response.status).toBe(422);
        expect(repository.creates).toEqual([]);
    });

    it("deletes only through user and team scoped repository criteria", async () => {
        const { dependencies, repository } = setup();
        repository.records.push({
            id: "42",
            name: "Disposable",
            abilities: ["delete"],
            lastUsedAt: null,
            expiresAt: null,
            createdAt: now,
            updatedAt: now,
        });
        const response = await handlePersonalAccessTokenRequest(
            new Request("https://crm.example.test/api/v1/personal-access-tokens/42", {
                method: "DELETE",
                headers: { "sec-fetch-site": "same-origin" },
            }),
            "42",
            dependencies,
        );
        expect(response.status).toBe(204);
        expect(repository.deleteCalls).toEqual([{ userId, teamId, tokenId: "42" }]);
    });

    it("returns 404 for malformed or inaccessible token IDs without leaking ownership", async () => {
        const { dependencies, repository } = setup();
        for (const tokenId of ["invalid", "999"]) {
            const response = await handlePersonalAccessTokenRequest(
                new Request(`https://crm.example.test/api/v1/personal-access-tokens/${tokenId}`, {
                    method: "DELETE",
                    headers: { "sec-fetch-site": "same-origin" },
                }),
                tokenId,
                dependencies,
            );
            expect(response.status).toBe(404);
        }
        expect(repository.deleteCalls).toEqual([{ userId, teamId, tokenId: "999" }]);
    });

    it("enforces method abilities before token storage access", async () => {
        const readOnly = setup(context(["read"]));
        const createOnly = setup(context(["create"]));
        const post = await handlePersonalAccessTokensCollectionRequest(
            new Request("https://crm.example.test/api/v1/personal-access-tokens", {
                method: "POST",
                body: JSON.stringify({ name: "Nope" }),
            }),
            readOnly.dependencies,
        );
        const list = await handlePersonalAccessTokensCollectionRequest(
            new Request("https://crm.example.test/api/v1/personal-access-tokens"),
            createOnly.dependencies,
        );
        expect(post.status).toBe(403);
        expect(list.status).toBe(403);
        expect(readOnly.repository.creates).toEqual([]);
        expect(createOnly.repository.listCalls).toEqual([]);
    });
});
