import { describe, expect, it } from "vitest";

import { ProductionApiAccessResolver } from "@/server/api/access";
import {
    ApiRateLimiter,
    type FixedWindowRateLimitResult,
    type FixedWindowRateLimitStore,
    type RateLimitBucket,
} from "@/server/api/rate-limiter";
import { handleUserRequest } from "@/server/api/user";
import { hashSanctumTokenSecret } from "@/server/auth/compatibility/sanctum";
import type { LegacySessionRecord } from "@/server/auth/compatibility/legacy-session";
import type {
    HttpAuthConfiguration,
    HttpAuthRepository,
    HttpAuthTeamRecord,
    HttpAuthUserRecord,
    PersonalAccessTokenRecord,
} from "@/server/auth/http";
import {
    HostedWorkspaceAccess,
    type HostedWorkspace,
    type HostedWorkspaceRepository,
} from "@/server/billing/hosted-workspace-access";
import { parseEnvironment } from "@/server/env";
import type { Ulid } from "@/server/ids";

const now = new Date("2026-08-18T12:00:00.000Z");
const userId = "01J00000000000000000000000" as Ulid;
const currentTeamId = "01J00000000000000000000001" as Ulid;
const selectedTeamId = "01J00000000000000000000002" as Ulid;
const tokenSecret = "access-token-secret";

const authConfiguration: HttpAuthConfiguration = {
    appKeys: [],
    sessionCookieName: "relaticle_session",
    sessionLifetimeMinutes: 120,
    requireEmailVerification: true,
};

const environment = parseEnvironment({
    APP_URL: "https://crm.example.test",
    APP_PANEL_PATH: "app",
    RELATICLE_FEATURE_BILLING: "true",
});

const defaultWorkspace = (
    overrides: Partial<HostedWorkspace> = {},
): HostedWorkspace => ({
    plan: "free",
    trialEndsAt: null,
    hostedFreeGrandfatheredAt: null,
    subscription: null,
    ...overrides,
});

class InMemoryHostedWorkspaceRepository implements HostedWorkspaceRepository {
    public calls = 0;

    public constructor(public workspace: HostedWorkspace | undefined) {}

    public async findForAccess(): Promise<HostedWorkspace | undefined> {
        this.calls += 1;

        return this.workspace;
    }
}

class InMemoryHttpAuthRepository implements HttpAuthRepository {
    public readonly user: HttpAuthUserRecord = {
        id: userId,
        name: "Ada Lovelace",
        email: "ada@example.test",
        emailVerifiedAt: now,
        currentTeamId,
        scheduledDeletionAt: null,
    };

    public readonly teams: readonly HttpAuthTeamRecord[] = [
        {
            id: currentTeamId,
            ownerUserId: userId,
            name: "Current Workspace",
            slug: "current-workspace",
            personalTeam: false,
        },
        {
            id: selectedTeamId,
            ownerUserId: userId,
            name: "Selected Workspace",
            slug: "selected-workspace",
            personalTeam: false,
        },
    ];

    public token: PersonalAccessTokenRecord = {
        id: "42",
        tokenableType: "user",
        tokenableId: userId,
        teamId: selectedTeamId,
        tokenHash: hashSanctumTokenSecret(tokenSecret),
        abilities: JSON.stringify(["*"]),
        expiresAt: null,
    };

    public async findPersonalAccessTokenById(
        tokenId: string,
    ): Promise<PersonalAccessTokenRecord | undefined> {
        return tokenId === this.token.id ? this.token : undefined;
    }

    public async findPersonalAccessTokenByHash(): Promise<
        PersonalAccessTokenRecord | undefined
    > {
        return undefined;
    }

    public async findSessionById(): Promise<LegacySessionRecord | undefined> {
        return undefined;
    }

    public async findUserById(
        requestedUserId: Ulid,
    ): Promise<HttpAuthUserRecord | undefined> {
        return requestedUserId === this.user.id ? this.user : undefined;
    }

    public async findTeamById(
        teamId: Ulid,
    ): Promise<HttpAuthTeamRecord | undefined> {
        return this.teams.find((team) => team.id === teamId);
    }

    public async hasTeamMembership(): Promise<boolean> {
        return false;
    }
}

class RecordingRateLimitStore implements FixedWindowRateLimitStore {
    public readonly calls: {
        buckets: readonly RateLimitBucket[];
        windowSeconds: number;
        nowEpochSeconds: number;
    }[] = [];

    public blockedBucketIndex: number | null = null;
    public attempts: readonly number[] = [1, 1];
    public resetAt = Math.floor(now.getTime() / 1_000) + 60;

    public async consume(
        buckets: readonly RateLimitBucket[],
        windowSeconds: number,
        nowEpochSeconds: number,
    ): Promise<FixedWindowRateLimitResult> {
        this.calls.push({ buckets, windowSeconds, nowEpochSeconds });

        return {
            allowed: this.blockedBucketIndex === null,
            blockedBucketIndex: this.blockedBucketIndex,
            buckets: buckets.map((bucket, index) => ({
                ...bucket,
                attempts: this.attempts[index] ?? 0,
                resetAt: this.resetAt,
            })),
        };
    }
}

const apiRequest = (method = "GET"): Request =>
    new Request("https://crm.example.test/api/v1/user", {
        method,
        headers: {
            authorization: `Bearer 42|${tokenSecret}`,
            "x-forwarded-for": "203.0.113.10, 10.0.0.4",
        },
    });

const dependencies = (
    workspace: HostedWorkspace | undefined = defaultWorkspace({ plan: "pro" }),
    billingEnabled = true,
) => {
    const auth = new InMemoryHttpAuthRepository();
    const hosted = new InMemoryHostedWorkspaceRepository(workspace);
    const rateStore = new RecordingRateLimitStore();
    const access = new ProductionApiAccessResolver(
        auth,
        authConfiguration,
        new ApiRateLimiter(rateStore, () => now),
        new HostedWorkspaceAccess(hosted, billingEnabled, () => now),
        environment,
    );

    return { access, auth, hosted, rateStore };
};

describe("hosted REST workspace access", () => {
    it.each([
        ["Free workspace", defaultWorkspace(), 402],
        ["manual Pro grant", defaultWorkspace({ plan: "pro" }), 200],
        [
            "expired Pro trial",
            defaultWorkspace({
                plan: "pro",
                trialEndsAt: new Date("2026-08-18T11:59:59.000Z"),
            }),
            402,
        ],
        [
            "Enterprise with expired trial marker",
            defaultWorkspace({
                plan: "enterprise",
                trialEndsAt: new Date("2026-08-18T11:59:59.000Z"),
            }),
            200,
        ],
        [
            "active generic trial",
            defaultWorkspace({
                trialEndsAt: new Date("2026-08-18T12:00:01.000Z"),
            }),
            200,
        ],
        [
            "grandfathered Free workspace",
            defaultWorkspace({ hostedFreeGrandfatheredAt: new Date(0) }),
            200,
        ],
        [
            "active subscription",
            defaultWorkspace({
                subscription: {
                    stripeStatus: "active",
                    trialEndsAt: null,
                    endsAt: null,
                },
            }),
            200,
        ],
        [
            "past-due subscription",
            defaultWorkspace({
                subscription: {
                    stripeStatus: "past_due",
                    trialEndsAt: null,
                    endsAt: null,
                },
            }),
            200,
        ],
        [
            "incomplete subscription",
            defaultWorkspace({
                subscription: {
                    stripeStatus: "incomplete",
                    trialEndsAt: null,
                    endsAt: null,
                },
            }),
            402,
        ],
        [
            "subscription trial",
            defaultWorkspace({
                subscription: {
                    stripeStatus: "incomplete",
                    trialEndsAt: new Date("2026-08-18T12:00:01.000Z"),
                    endsAt: null,
                },
            }),
            200,
        ],
        [
            "cancellation grace period",
            defaultWorkspace({
                subscription: {
                    stripeStatus: "canceled",
                    trialEndsAt: null,
                    endsAt: new Date("2026-08-18T12:00:01.000Z"),
                },
            }),
            200,
        ],
    ] as const)("enforces %s", async (_label, workspace, expectedStatus) => {
        const { access } = dependencies(workspace);
        const response = await handleUserRequest(apiRequest(), access);

        expect(response.status).toBe(expectedStatus);
    });

    it("returns Laravel's exact paused-workspace payload and billing URL", async () => {
        const { access } = dependencies(defaultWorkspace());
        const response = await handleUserRequest(apiRequest(), access);

        expect(response.status).toBe(402);
        expect(response.headers.get("x-ratelimit-limit")).toBe("300");
        await expect(response.json()).resolves.toEqual({
            error: "workspace_subscription_required",
            message:
                "This workspace is paused. Subscribe to Cloud Pro to restore access.",
            upgrade_url:
                "https://crm.example.test/app/selected-workspace/billing",
        });
    });

    it("bypasses billing storage when hosted billing is disabled", async () => {
        const { access, hosted } = dependencies(defaultWorkspace(), false);
        const response = await handleUserRequest(apiRequest(), access);

        expect(response.status).toBe(200);
        expect(hosted.calls).toBe(0);
    });
});

describe("REST API rate limiting", () => {
    it("uses the persisted workspace aggregate key and selected credential method bucket", async () => {
        const { access, rateStore } = dependencies();

        await access.resolve(apiRequest("GET"), "request-read");
        await access.resolve(apiRequest("HEAD"), "request-write");

        expect(rateStore.calls).toHaveLength(2);
        expect(rateStore.calls[0]).toMatchObject({
            buckets: [
                { key: `team:${currentTeamId}`, limit: 600 },
                { key: "token:42:read", limit: 300 },
            ],
            windowSeconds: 60,
        });
        expect(rateStore.calls[1]?.buckets).toEqual([
            { key: `team:${currentTeamId}`, limit: 600 },
            { key: "token:42:write", limit: 60 },
        ]);
    });

    it("returns the blocking bucket headers before ability and hosted checks", async () => {
        const { access, auth, rateStore } = dependencies(defaultWorkspace());
        auth.token = {
            ...auth.token,
            abilities: JSON.stringify(["read"]),
        };
        rateStore.blockedBucketIndex = 1;
        rateStore.attempts = [24, 60];
        rateStore.resetAt = Math.floor(now.getTime() / 1_000) + 27;

        const result = await access.resolve(apiRequest("POST"), "request-1");

        expect(result).toEqual({
            allowed: false,
            status: 429,
            body: { message: "Too Many Attempts." },
            headers: {
                "x-ratelimit-limit": "60",
                "x-ratelimit-remaining": "0",
                "retry-after": "27",
                "x-ratelimit-reset": String(rateStore.resetAt),
            },
        });
    });

    it("does not count invalid credentials", async () => {
        const { access, auth, rateStore } = dependencies();
        auth.token = { ...auth.token, tokenHash: "invalid" };

        const result = await access.resolve(apiRequest(), "request-1");

        expect(result).toMatchObject({ allowed: false, status: 401 });
        expect(rateStore.calls).toEqual([]);
    });

    it("exposes the bucket with the least remaining quota on allowed responses", async () => {
        const { access, rateStore } = dependencies();
        rateStore.attempts = [595, 2];

        const response = await handleUserRequest(apiRequest(), access);

        expect(response.status).toBe(200);
        expect(response.headers.get("x-ratelimit-limit")).toBe("600");
        expect(response.headers.get("x-ratelimit-remaining")).toBe("5");
        expect(response.headers.has("retry-after")).toBe(false);
    });
});
