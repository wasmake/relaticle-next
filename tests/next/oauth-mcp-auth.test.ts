import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
    authorizationServerMetadata,
    handleAuthorization,
    handleClientRegistration,
    handleTokenExchange,
    protectedResourceMetadata,
} from "@/server/oauth/http";
import { OAuthService } from "@/server/oauth/service";
import {
    OAuthError,
    type AccessToken,
    type AuthorizationCode,
    type OAuthClient,
    type OAuthRepository,
    type RefreshToken,
} from "@/server/oauth/types";
import type { Ulid } from "@/server/ids";
import { createRequestContext } from "@/server/context/request-context";

const userId = "01ARZ3NDEKTSV4RRFFQ69G5FAV" as Ulid;
const teamId = "01ARZ3NDEKTSV4RRFFQ69G5FAW" as Ulid;
const now = new Date("2026-08-19T12:00:00.000Z");

class MemoryOAuthRepository implements OAuthRepository {
    public clients = new Map<string, OAuthClient>();
    public codes = new Map<string, AuthorizationCode>();
    public consumedCodes = new Set<string>();
    public accessTokens = new Map<string, AccessToken>();
    public refreshTokens = new Map<string, RefreshToken>();
    public identityAvailable = true;

    public async createClient(client: OAuthClient): Promise<void> {
        this.clients.set(client.id, client);
    }
    public async findClient(id: string): Promise<OAuthClient | undefined> {
        return this.clients.get(id);
    }
    public async createAuthorizationCode(code: AuthorizationCode): Promise<void> {
        this.codes.set(code.id, code);
    }
    public async findAuthorizationCode(id: string): Promise<AuthorizationCode | undefined> {
        return this.consumedCodes.has(id) ? undefined : this.codes.get(id);
    }
    public async consumeAuthorizationCode(id: string): Promise<boolean> {
        if (!this.codes.has(id) || this.consumedCodes.has(id)) return false;
        this.consumedCodes.add(id);
        return true;
    }
    public async createTokenPair(access: AccessToken, refresh: RefreshToken): Promise<void> {
        this.accessTokens.set(access.id, access);
        this.refreshTokens.set(refresh.id, refresh);
    }
    public async findAccessToken(id: string): Promise<AccessToken | undefined> {
        return this.accessTokens.get(id);
    }
    public async findRefreshToken(id: string): Promise<RefreshToken | undefined> {
        return this.refreshTokens.get(id);
    }
    public async rotateRefreshToken(oldRefreshId: string, oldAccessId: string, access: AccessToken, refresh: RefreshToken): Promise<boolean> {
        const oldRefresh = this.refreshTokens.get(oldRefreshId);
        if (oldRefresh === undefined || oldRefresh.revoked) return false;
        this.refreshTokens.set(oldRefreshId, { ...oldRefresh, revoked: true });
        const oldAccess = this.accessTokens.get(oldAccessId);
        if (oldAccess !== undefined) this.accessTokens.set(oldAccessId, { ...oldAccess, revoked: true });
        this.accessTokens.set(access.id, access);
        this.refreshTokens.set(refresh.id, refresh);
        return true;
    }
    public async revokeAccessToken(id: string): Promise<boolean> {
        const token = this.accessTokens.get(id);
        if (token === undefined) return false;
        this.accessTokens.set(id, { ...token, revoked: true });
        return true;
    }
    public async revokeRefreshToken(id: string): Promise<string | undefined> {
        const token = this.refreshTokens.get(id);
        if (token === undefined) return undefined;
        this.refreshTokens.set(id, { ...token, revoked: true });
        return token.accessTokenId;
    }
    public async revokeRefreshTokenFamily(familyId: string): Promise<void> {
        for (const [id, token] of this.refreshTokens) {
            if (token.familyId !== familyId) continue;
            this.refreshTokens.set(id, { ...token, revoked: true });
            const access = this.accessTokens.get(token.accessTokenId);
            if (access !== undefined) this.accessTokens.set(access.id, { ...access, revoked: true });
        }
    }
    public async findIdentity(requestUserId: Ulid, requestTeamId: Ulid) {
        return this.identityAvailable && requestUserId === userId && requestTeamId === teamId
            ? { user: { id: userId, name: "Ada", email: "ada@example.test" }, team: { id: teamId, name: "Acme", slug: "acme" } }
            : undefined;
    }
}

const setupGrant = async () => {
    const repository = new MemoryOAuthRepository();
    const service = new OAuthService(repository, () => now);
    const client = await service.registerClient({
        clientName: "MCP Client",
        redirectUris: ["https://client.example.test/callback"],
    });
    const verifier = "a".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const validation = await service.validateAuthorization({
        clientId: client.id,
        redirectUri: client.redirectUris[0] ?? "",
        responseType: "code",
        codeChallenge: challenge,
        codeChallengeMethod: "S256",
        scope: "read update",
    });
    const code = await service.authorize({
        userId,
        teamId,
        clientId: client.id,
        redirectUri: client.redirectUris[0] ?? "",
        codeChallenge: challenge,
        scopes: validation.scopes,
    });
    return { repository, service, client, verifier, code };
};

describe("OAuth 2.1 server", () => {
    it("publishes authorization and protected-resource metadata", () => {
        expect(authorizationServerMetadata("https://crm.example.test")).toMatchObject({
            authorization_endpoint: "https://crm.example.test/oauth/authorize",
            registration_endpoint: "https://crm.example.test/oauth/register",
            code_challenge_methods_supported: ["S256"],
        });
        expect(protectedResourceMetadata("https://crm.example.test")).toMatchObject({
            resource: "https://crm.example.test/mcp",
            authorization_servers: ["https://crm.example.test"],
        });
    });

    it("registers only public clients with secure or loopback redirects", async () => {
        const repository = new MemoryOAuthRepository();
        const service = new OAuthService(repository, () => now);
        const response = await handleClientRegistration(
            new Request("https://crm.example.test/oauth/register", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ client_name: "Desktop", redirect_uris: ["http://127.0.0.1:4567/callback"] }),
            }),
            service,
        );
        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toMatchObject({ token_endpoint_auth_method: "none", response_types: ["code"] });

        const invalid = await handleClientRegistration(
            new Request("https://crm.example.test/oauth/register", { method: "POST", body: JSON.stringify({ client_name: "Bad", redirect_uris: ["http://evil.example/callback"] }) }),
            service,
        );
        expect(invalid.status).toBe(400);
    });

    it("exchanges an S256 code once, rotates refresh tokens, and narrows scopes", async () => {
        const { repository, service, client, verifier, code } = await setupGrant();
        const first = await service.exchangeAuthorizationCode({ code, clientId: client.id, redirectUri: client.redirectUris[0] ?? "", codeVerifier: verifier });
        expect(first).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: "read update" });
        await expect(service.exchangeAuthorizationCode({ code, clientId: client.id, redirectUri: client.redirectUris[0] ?? "", codeVerifier: verifier })).rejects.toMatchObject({ code: "invalid_grant" });

        const rotated = await service.exchangeRefreshToken({ refreshToken: first.refresh_token as string, clientId: client.id, scope: "read" });
        expect(rotated).toMatchObject({ token_type: "Bearer", scope: "read" });
        await expect(service.exchangeRefreshToken({ refreshToken: first.refresh_token as string, clientId: client.id })).rejects.toMatchObject({ code: "invalid_grant" });
        expect([...repository.accessTokens.values()].filter((token) => token.revoked)).toHaveLength(2);
        expect([...repository.refreshTokens.values()].every((token) => token.revoked)).toBe(true);
    });

    it("renders consent and binds an approved code to the authenticated workspace", async () => {
        const repository = new MemoryOAuthRepository();
        const service = new OAuthService(repository, () => now);
        const client = await service.registerClient({ clientName: "Assistant", redirectUris: ["https://client.example.test/callback"] });
        const verifier = "v".repeat(64);
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        const parameters = new URLSearchParams({ client_id: client.id, redirect_uri: client.redirectUris[0] ?? "", response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: "read", team_id: teamId, state: "opaque-state" });
        const browserAuth = async () => ({
            ok: true as const,
            context: createRequestContext({ requestId: "browser", userId, teamId, credential: { kind: "session", sessionId: "session" } }),
            user: { id: userId, name: "Ada", email: "ada@example.test" },
            team: { id: teamId, name: "Acme", slug: "acme", personalTeam: false },
        });

        const consent = await handleAuthorization(new Request(`https://crm.example.test/oauth/authorize?${parameters}`), service, browserAuth);
        expect(consent.headers.get("content-type")).toContain("text/html");
        expect(await consent.text()).toContain("Authorize Assistant");

        parameters.set("decision", "approve");
        const approved = await handleAuthorization(new Request("https://crm.example.test/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: parameters }), service, browserAuth);
        const location = new URL(approved.headers.get("location") ?? "");
        expect(location.origin + location.pathname).toBe("https://client.example.test/callback");
        expect(location.searchParams.get("state")).toBe("opaque-state");
        expect(location.searchParams.get("code")).toMatch(/^crm_ac_/u);
        expect([...repository.codes.values()][0]).toMatchObject({ userId, teamId, clientId: client.id });
    });

    it("rejects bad PKCE and malformed token requests", async () => {
        const { service, client, code } = await setupGrant();
        await expect(service.exchangeAuthorizationCode({ code, clientId: client.id, redirectUri: client.redirectUris[0] ?? "", codeVerifier: "b".repeat(64) })).rejects.toBeInstanceOf(OAuthError);
        const response = await handleTokenExchange(
            new Request("https://crm.example.test/oauth/token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
            service,
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
    });

    it("authenticates a bearer in its bound workspace and invalidates revoked access", async () => {
        const { repository, service, client, verifier, code } = await setupGrant();
        const pair = await service.exchangeAuthorizationCode({ code, clientId: client.id, redirectUri: client.redirectUris[0] ?? "", codeVerifier: verifier });
        const accessToken = pair.access_token as string;
        const identity = await service.authenticate(`Bearer ${accessToken}`, "request-1");
        expect(identity).toMatchObject({ context: { userId, teamId, credential: { kind: "oauth", scopes: ["read", "update"] } } });

        repository.identityAvailable = false;
        await expect(service.authenticate(`Bearer ${accessToken}`, "request-2")).rejects.toMatchObject({ code: "invalid_token" });
        repository.identityAvailable = true;
        await service.revoke(accessToken, client.id);
        await expect(service.authenticate(`Bearer ${accessToken}`, "request-3")).rejects.toMatchObject({ code: "invalid_token" });
    });
});
