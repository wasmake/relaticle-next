import { describe, expect, it } from "vitest";

import { encryptLaravelCookie } from "@/server/auth/compatibility/laravel-encrypter";
import { hashSanctumTokenSecret } from "@/server/auth/compatibility/sanctum";
import type { LegacySessionRecord } from "@/server/auth/compatibility/legacy-session";
import {
    apiAbilityForHttpMethod,
    createHttpAuthConfiguration,
    deriveLaravelSessionCookieName,
    resolveHttpAuth,
    type HttpAuthConfiguration,
    type HttpAuthRepository,
    type HttpAuthResult,
    type HttpAuthTeamRecord,
    type HttpAuthUserRecord,
    type PersonalAccessTokenRecord,
} from "@/server/auth/http";
import { parseEnvironment } from "@/server/env";
import type { Ulid } from "@/server/ids";

const now = new Date("2026-08-18T12:00:00.000Z");
const appKey = Buffer.from("0123456789abcdef0123456789abcdef", "utf8");
const previousAppKey = Buffer.from(
    "fedcba9876543210fedcba9876543210",
    "utf8",
);
const userId = "01J00000000000000000000000" as Ulid;
const otherUserId = "01J00000000000000000000009" as Ulid;
const currentTeamId = "01J00000000000000000000001" as Ulid;
const selectedTeamId = "01J00000000000000000000002" as Ulid;
const missingTeamId = "01J00000000000000000000003" as Ulid;
const sessionId = "S".repeat(40);
const tokenSecret = "personal-token-secret";

const configuration: HttpAuthConfiguration = Object.freeze({
    appKeys: Object.freeze([appKey]),
    sessionCookieName: "relaticle_session",
    sessionLifetimeMinutes: 120,
    requireEmailVerification: true,
});

const defaultUser = (
    overrides: Partial<HttpAuthUserRecord> = {},
): HttpAuthUserRecord => ({
    id: userId,
    name: "Ada Lovelace",
    email: "ada@example.com",
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    currentTeamId,
    scheduledDeletionAt: null,
    ...overrides,
});

const defaultTeam = (
    overrides: Partial<HttpAuthTeamRecord> = {},
): HttpAuthTeamRecord => ({
    id: currentTeamId,
    ownerUserId: userId,
    name: "Analytical Engines",
    slug: "analytical-engines",
    personalTeam: false,
    scheduledDeletionAt: null,
    ...overrides,
});

const defaultToken = (
    overrides: Partial<PersonalAccessTokenRecord> = {},
): PersonalAccessTokenRecord => ({
    id: "42",
    tokenableType: "user",
    tokenableId: userId,
    teamId: null,
    tokenHash: hashSanctumTokenSecret(tokenSecret),
    abilities: JSON.stringify(["*"]),
    expiresAt: null,
    ...overrides,
});

class InMemoryHttpAuthRepository implements HttpAuthRepository {
    public readonly tokenIdLookups: string[] = [];
    public readonly tokenHashLookups: string[] = [];
    public readonly sessionLookups: string[] = [];
    public readonly membershipLookups: string[] = [];

    private readonly tokens: PersonalAccessTokenRecord[];
    private readonly sessions: LegacySessionRecord[];
    private readonly users: HttpAuthUserRecord[];
    private readonly teams: HttpAuthTeamRecord[];
    private readonly memberships: Set<string>;

    public constructor(
        input: Readonly<{
            tokens?: readonly PersonalAccessTokenRecord[];
            sessions?: readonly LegacySessionRecord[];
            users?: readonly HttpAuthUserRecord[];
            teams?: readonly HttpAuthTeamRecord[];
            memberships?: readonly string[];
        }> = {},
    ) {
        this.tokens = [...(input.tokens ?? [])];
        this.sessions = [...(input.sessions ?? [])];
        this.users = [...(input.users ?? [defaultUser()])];
        this.teams = [...(input.teams ?? [defaultTeam()])];
        this.memberships = new Set(input.memberships ?? []);
    }

    public async findPersonalAccessTokenById(
        tokenIdToFind: string,
    ): Promise<PersonalAccessTokenRecord | undefined> {
        this.tokenIdLookups.push(tokenIdToFind);

        return this.tokens.find((token) => token.id === tokenIdToFind);
    }

    public async findPersonalAccessTokenByHash(
        tokenHash: string,
    ): Promise<PersonalAccessTokenRecord | undefined> {
        this.tokenHashLookups.push(tokenHash);

        return this.tokens.find((token) => token.tokenHash === tokenHash);
    }

    public async findSessionById(
        sessionIdToFind: string,
    ): Promise<LegacySessionRecord | undefined> {
        this.sessionLookups.push(sessionIdToFind);

        return this.sessions.find((session) => session.id === sessionIdToFind);
    }

    public async findUserById(
        userIdToFind: Ulid,
    ): Promise<HttpAuthUserRecord | undefined> {
        return this.users.find((user) => user.id === userIdToFind);
    }

    public async findTeamById(
        teamIdToFind: Ulid,
    ): Promise<HttpAuthTeamRecord | undefined> {
        return this.teams.find((team) => team.id === teamIdToFind);
    }

    public async hasTeamMembership(
        userIdToFind: Ulid,
        teamIdToFind: Ulid,
    ): Promise<boolean> {
        const membership = `${userIdToFind}:${teamIdToFind}`;
        this.membershipLookups.push(membership);

        return this.memberships.has(membership);
    }
}

const activeSession = (
    overrides: Partial<LegacySessionRecord> = {},
): LegacySessionRecord => ({
    id: sessionId,
    userId,
    lastActivity: Date.parse("2026-08-18T11:00:00.000Z") / 1_000,
    ...overrides,
});

const request = (
    method: string,
    headers: Readonly<Record<string, string>> = {},
): Request =>
    new Request("https://crm.example.test/api/v1/companies", {
        method,
        headers,
    });

const resolve = (
    repository: HttpAuthRepository,
    httpRequest: Request,
    authConfiguration: HttpAuthConfiguration = configuration,
): Promise<HttpAuthResult> =>
    resolveHttpAuth(
        { request: httpRequest, requestId: "request-1", now },
        repository,
        authConfiguration,
    );

const expectFailure = (
    result: HttpAuthResult,
    reason: Extract<HttpAuthResult, { ok: false }>["failure"]["reason"],
    status: 401 | 403,
): void => {
    expect(result).toEqual({ ok: false, failure: { reason, status } });
    expect(Object.isFrozen(result)).toBe(true);

    if (!result.ok) {
        expect(Object.isFrozen(result.failure)).toBe(true);
    }
};

describe("HTTP personal access token authentication", () => {
    it("resolves an id-based token, honors its pinned team, and expands wildcard abilities", async () => {
        const originalUser = defaultUser();
        const repository = new InMemoryHttpAuthRepository({
            tokens: [defaultToken({ teamId: selectedTeamId })],
            users: [originalUser],
            teams: [
                defaultTeam(),
                defaultTeam({
                    id: selectedTeamId,
                    name: "Difference Engine",
                    slug: "difference-engine",
                }),
            ],
        });

        const result = await resolve(
            repository,
            request("GET", {
                authorization: `Bearer 42|${tokenSecret}`,
                "x-team-id": currentTeamId,
            }),
        );

        expect(result.ok).toBe(true);

        if (!result.ok) {
            return;
        }

        expect(repository.tokenIdLookups).toEqual(["42"]);
        expect(repository.tokenHashLookups).toEqual([]);
        expect(result.context).toEqual({
            requestId: "request-1",
            userId,
            teamId: selectedTeamId,
            credential: {
                kind: "personal_access_token",
                tokenId: "42",
                abilities: ["read", "create", "update", "delete"],
            },
        });
        expect(result.user).toEqual({
            id: userId,
            name: "Ada Lovelace",
            email: "ada@example.com",
        });
        expect(result.team).toEqual({
            id: selectedTeamId,
            name: "Difference Engine",
            slug: "difference-engine",
            personalTeam: false,
        });
        expect(originalUser.currentTeamId).toBe(currentTeamId);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.context)).toBe(true);
        expect(Object.isFrozen(result.context.credential)).toBe(true);
        expect(result.context.credential.kind).toBe("personal_access_token");

        if (result.context.credential.kind === "personal_access_token") {
            expect(Object.isFrozen(result.context.credential.abilities)).toBe(
                true,
            );
        }

        expect(Object.isFrozen(result.user)).toBe(true);
        expect(Object.isFrozen(result.team)).toBe(true);
        expect(JSON.stringify(result)).not.toContain(tokenSecret);
        expect(result.user).not.toHaveProperty("password");
        expect(result.team).not.toHaveProperty("ownerUserId");
    });

    it("looks up a legacy raw token by SHA-256 hash and accepts pivot membership", async () => {
        const repository = new InMemoryHttpAuthRepository({
            tokens: [
                defaultToken({
                    abilities: JSON.stringify(["future", "update", "read"]),
                }),
            ],
            teams: [
                defaultTeam({
                    id: selectedTeamId,
                    ownerUserId: otherUserId,
                }),
            ],
            memberships: [`${userId}:${selectedTeamId}`],
        });

        const result = await resolve(
            repository,
            request("PATCH", {
                authorization: `bearer ${tokenSecret}`,
                "x-team-id": selectedTeamId.toLowerCase(),
            }),
        );

        expect(result.ok).toBe(true);

        if (!result.ok) {
            return;
        }

        expect(repository.tokenIdLookups).toEqual([]);
        expect(repository.tokenHashLookups).toEqual([
            hashSanctumTokenSecret(tokenSecret),
        ]);
        expect(repository.membershipLookups).toEqual([
            `${userId}:${selectedTeamId}`,
        ]);
        expect(result.context.teamId).toBe(selectedTeamId);
        expect(result.context.credential).toEqual({
            kind: "personal_access_token",
            tokenId: "42",
            abilities: ["read", "update"],
        });
    });

    it.each([
        ["GET", "read"],
        ["HEAD", "read"],
        ["OPTIONS", "read"],
        ["POST", "create"],
        ["PUT", "update"],
        ["PATCH", "update"],
        ["DELETE", "delete"],
    ] as const)("maps %s requests to the %s ability", (method, ability) => {
        expect(apiAbilityForHttpMethod(method)).toBe(ability);
    });

    it("denies a valid token that lacks the HTTP method ability", async () => {
        const repository = new InMemoryHttpAuthRepository({
            tokens: [defaultToken({ abilities: JSON.stringify(["read"]) })],
        });
        const result = await resolve(
            repository,
            request("POST", {
                authorization: `Bearer 42|${tokenSecret}`,
            }),
        );

        expectFailure(result, "ability_denied", 403);
    });

    it.each([
        {
            label: "an expired token",
            token: defaultToken({ expiresAt: now }),
            reason: "token_expired" as const,
        },
        {
            label: "a non-user morph token",
            token: defaultToken({ tokenableType: "system_administrator" }),
            reason: "token_type_unsupported" as const,
        },
        {
            label: "malformed abilities JSON",
            token: defaultToken({ abilities: "not-json" }),
            reason: "token_abilities_invalid" as const,
        },
        {
            label: "non-string abilities",
            token: defaultToken({ abilities: JSON.stringify(["read", 1]) }),
            reason: "token_abilities_invalid" as const,
        },
    ])("rejects $label", async ({ token, reason }) => {
        const repository = new InMemoryHttpAuthRepository({ tokens: [token] });
        const result = await resolve(
            repository,
            request("GET", {
                authorization: `Bearer 42|${tokenSecret}`,
            }),
        );

        expectFailure(result, reason, 401);
    });

    it("rejects malformed and incorrect Bearer tokens without exposing them", async () => {
        const repository = new InMemoryHttpAuthRepository({
            tokens: [defaultToken()],
            sessions: [activeSession()],
        });
        const encryptedSession = encryptLaravelCookie(
            configuration.sessionCookieName,
            sessionId,
            appKey,
        );
        const malformed = await resolve(
            repository,
            request("GET", {
                authorization: "Bearer token with spaces",
                cookie: `${configuration.sessionCookieName}=${encryptedSession}`,
            }),
        );
        const incorrectSecret = "do-not-leak-this-secret";
        const incorrect = await resolve(
            repository,
            request("GET", {
                authorization: `Bearer 42|${incorrectSecret}`,
            }),
        );

        expectFailure(malformed, "token_invalid", 401);
        expectFailure(incorrect, "token_invalid", 401);
        expect(repository.sessionLookups).toEqual([]);
        expect(JSON.stringify(incorrect)).not.toContain(incorrectSecret);
    });
});

describe("HTTP Laravel database-session authentication", () => {
    it("derives Laravel's default cookie name from APP_NAME and honors SESSION_COOKIE", () => {
        const defaultCookie = createHttpAuthConfiguration(
            parseEnvironment({
                APP_NAME: "My CRM @ Home",
                APP_KEY: `base64:${appKey.toString("base64")}`,
            }),
        );
        const overriddenCookie = createHttpAuthConfiguration(
            parseEnvironment({
                APP_NAME: "Ignored",
                APP_KEY: `base64:${appKey.toString("base64")}`,
                SESSION_COOKIE: "shared_laravel_session",
            }),
        );

        expect(deriveLaravelSessionCookieName("My CRM @ Home")).toBe(
            "my_crm_at_home_session",
        );
        expect(defaultCookie.sessionCookieName).toBe("my_crm_at_home_session");
        expect(overriddenCookie.sessionCookieName).toBe(
            "shared_laravel_session",
        );
    });

    it("decrypts a rotated-key cookie and resolves the indexed session user_id", async () => {
        const repository = new InMemoryHttpAuthRepository({
            sessions: [activeSession()],
        });
        const rotatedConfiguration: HttpAuthConfiguration = {
            ...configuration,
            appKeys: Object.freeze([appKey, previousAppKey]),
        };
        const encryptedSession = encryptLaravelCookie(
            configuration.sessionCookieName,
            sessionId,
            previousAppKey,
        );
        const result = await resolve(
            repository,
            request("POST", {
                cookie: `theme=dark; ${configuration.sessionCookieName}=${encodeURIComponent(encryptedSession)}`,
            }),
            rotatedConfiguration,
        );

        expect(result.ok).toBe(true);

        if (!result.ok) {
            return;
        }

        expect(repository.sessionLookups).toEqual([sessionId]);
        expect(result.context.credential).toEqual({
            kind: "session",
            sessionId,
        });
        expect(result.context.teamId).toBe(currentTeamId);
    });

    it("falls back to current_team_id for an invalid team header", async () => {
        const repository = new InMemoryHttpAuthRepository({
            sessions: [activeSession()],
        });
        const encryptedSession = encryptLaravelCookie(
            configuration.sessionCookieName,
            sessionId,
            appKey,
        );
        const result = await resolve(
            repository,
            request("DELETE", {
                cookie: `${configuration.sessionCookieName}=${encryptedSession}`,
                "x-team-id": "not-a-ulid",
            }),
        );

        expect(result.ok).toBe(true);

        if (result.ok) {
            expect(result.context.teamId).toBe(currentTeamId);
        }
    });

    it("rejects expired and unauthenticated sessions with typed failures", async () => {
        const expiredRepository = new InMemoryHttpAuthRepository({
            sessions: [
                activeSession({
                    lastActivity:
                        Date.parse("2026-08-18T09:59:59.000Z") / 1_000,
                }),
            ],
        });
        const encryptedSession = encryptLaravelCookie(
            configuration.sessionCookieName,
            sessionId,
            appKey,
        );
        const expired = await resolve(
            expiredRepository,
            request("GET", {
                cookie: `${configuration.sessionCookieName}=${encryptedSession}`,
            }),
        );
        const missing = await resolve(
            new InMemoryHttpAuthRepository(),
            request("GET"),
        );

        expectFailure(expired, "session_invalid", 401);
        expectFailure(missing, "credentials_missing", 401);
    });
});

describe("HTTP authenticated user and tenant gates", () => {
    const bearerHeaders = {
        authorization: `Bearer 42|${tokenSecret}`,
    };

    it("enforces email verification only when configured", async () => {
        const repository = new InMemoryHttpAuthRepository({
            tokens: [defaultToken()],
            users: [defaultUser({ emailVerifiedAt: null })],
        });
        const required = await resolve(
            repository,
            request("GET", bearerHeaders),
        );
        const optional = await resolve(
            repository,
            request("GET", bearerHeaders),
            { ...configuration, requireEmailVerification: false },
        );

        expectFailure(required, "email_unverified", 403);
        expect(optional.ok).toBe(true);
    });

    it("rejects a user as soon as account deletion is scheduled", async () => {
        const repository = new InMemoryHttpAuthRepository({
            tokens: [defaultToken()],
            users: [defaultUser({ scheduledDeletionAt: new Date(now) })],
        });
        const result = await resolve(
            repository,
            request("GET", bearerHeaders),
        );

        expectFailure(result, "user_scheduled_for_deletion", 403);
    });

    it("rejects a missing selected team", async () => {
        const repository = new InMemoryHttpAuthRepository({
            tokens: [defaultToken()],
            users: [defaultUser({ currentTeamId: missingTeamId })],
            teams: [],
        });
        const result = await resolve(
            repository,
            request("GET", bearerHeaders),
        );

        expectFailure(result, "team_not_found", 403);
    });

    it("rejects a workspace as soon as deletion is scheduled", async () => {
        const repository = new InMemoryHttpAuthRepository({
            tokens: [defaultToken()],
            teams: [defaultTeam({ scheduledDeletionAt: new Date(now) })],
        });
        const result = await resolve(repository, request("GET", bearerHeaders));

        expectFailure(result, "team_scheduled_for_deletion", 403);
    });

    it("rejects a team when the user is neither owner nor team_user member", async () => {
        const repository = new InMemoryHttpAuthRepository({
            tokens: [defaultToken()],
            teams: [defaultTeam({ ownerUserId: otherUserId })],
        });
        const result = await resolve(
            repository,
            request("GET", bearerHeaders),
        );

        expectFailure(result, "team_membership_required", 403);
    });

    it("rejects a deleted credential user without leaking the identifier", async () => {
        const repository = new InMemoryHttpAuthRepository({
            tokens: [defaultToken()],
            users: [],
        });
        const result = await resolve(
            repository,
            request("GET", bearerHeaders),
        );

        expectFailure(result, "user_not_found", 401);
        expect(JSON.stringify(result)).not.toContain(userId);
    });
});
