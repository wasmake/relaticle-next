import { randomBytes } from "node:crypto";

import { and, eq, isNotNull, isNull, or } from "drizzle-orm";

import { encryptLaravelCookie } from "@/server/auth/compatibility/laravel-encrypter";
import { verifyLaravelPassword } from "@/server/auth/compatibility/password";
import { createHttpAuthConfiguration } from "@/server/auth/http/configuration";
import { getDatabase } from "@/server/db/client";
import { sessions, teams, teamUser, users } from "@/server/db/schema";
import { getEnvironment } from "@/server/env";
import type { Ulid } from "@/server/ids";
import { createSignedToken } from "./signed-token";

export type BrowserLoginFailure =
    | "invalid_credentials"
    | "email_unverified"
    | "account_scheduled_for_deletion"
    | "session_configuration_missing"
    | "two_factor_required";

export type BrowserLoginResult =
    | Readonly<{
          ok: true;
          cookieName: string;
          cookieValue: string;
          lifetimeSeconds: number;
          teamSlug: string | null;
          userId: Ulid;
      }>
    | Readonly<{ ok: false; reason: BrowserLoginFailure; challengeToken?: string }>;

type BrowserLoginInput = Readonly<{
    email: string;
    password: string;
    ipAddress: string | null;
    userAgent: string | null;
    now?: Date;
    remember?: boolean;
    next?: string;
}>;

type SessionContext = Readonly<{ ipAddress: string | null; userAgent: string | null; now?: Date; remember?: boolean }>;

export const createTwoFactorChallenge = (userId: Ulid, input: SessionContext & { next?: string }): string | undefined =>
    createSignedToken({ userId, nonce: randomBytes(32).toString("base64url"), remember: input.remember === true, next: input.next, expiresAt: Date.now() + 10 * 60_000 });

export const createBrowserSessionForUser = async (userId: Ulid, input: SessionContext): Promise<BrowserLoginResult> => {
    const database = getDatabase();
    const environment = getEnvironment();
    const configuration = createHttpAuthConfiguration(environment);
    const currentKey = configuration.appKeys[0];
    if (currentKey === undefined) return { ok: false, reason: "session_configuration_missing" };
    const [user] = await database.select({ currentTeamId: users.currentTeamId, scheduledDeletionAt: users.scheduledDeletionAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (user === undefined || user.scheduledDeletionAt !== null) return { ok: false, reason: "account_scheduled_for_deletion" };
    const [team] = await database.select({ slug: teams.slug }).from(teams).leftJoin(teamUser, and(eq(teamUser.teamId, teams.id), eq(teamUser.userId, userId))).where(and(user.currentTeamId === null ? undefined : eq(teams.id, user.currentTeamId), isNull(teams.scheduledDeletionAt), or(eq(teams.userId, userId), isNotNull(teamUser.id)))).limit(1);
    const now = input.now ?? new Date();
    const sessionId = randomBytes(20).toString("hex");
    const rememberUntil = input.remember === true ? Math.floor(now.getTime() / 1_000) + environment.REMEMBER_ME_DAYS * 86_400 : undefined;
    await database.transaction(async (transaction) => {
        await transaction.insert(sessions).values({ id: sessionId, userId, ipAddress: input.ipAddress, userAgent: input.userAgent, payload: rememberUntil === undefined ? "" : `relaticle:${JSON.stringify({ rememberUntil })}`, lastActivity: Math.floor(now.getTime() / 1_000) });
        await transaction.update(users).set({ lastLoginAt: now, rememberToken: rememberUntil === undefined ? null : randomBytes(32).toString("base64url"), updatedAt: now }).where(eq(users.id, userId));
    });
    return { ok: true, cookieName: configuration.sessionCookieName, cookieValue: encryptLaravelCookie(configuration.sessionCookieName, sessionId, currentKey), lifetimeSeconds: input.remember === true ? environment.REMEMBER_ME_DAYS * 86_400 : configuration.sessionLifetimeMinutes * 60, teamSlug: team?.slug ?? null, userId };
};

export const createBrowserSession = async (
    input: BrowserLoginInput,
): Promise<BrowserLoginResult> => {
    const database = getDatabase();
    const environment = getEnvironment();
    const [user] = await database
        .select({
            id: users.id,
            password: users.password,
            emailVerifiedAt: users.emailVerifiedAt,
            scheduledDeletionAt: users.scheduledDeletionAt,
            twoFactorConfirmedAt: users.twoFactorConfirmedAt,
        })
        .from(users)
        .where(eq(users.email, input.email.trim().toLowerCase()))
        .limit(1);

    if (
        user?.password === null ||
        user === undefined ||
        !(await verifyLaravelPassword(input.password, user.password))
    ) {
        return { ok: false, reason: "invalid_credentials" };
    }

    if (
        environment.REQUIRE_EMAIL_VERIFICATION &&
        user.emailVerifiedAt === null
    ) {
        return { ok: false, reason: "email_unverified" };
    }

    if (user.scheduledDeletionAt !== null) {
        return { ok: false, reason: "account_scheduled_for_deletion" };
    }

    if (user.twoFactorConfirmedAt !== null) {
        const challengeToken = createTwoFactorChallenge(user.id, input);
        return challengeToken === undefined
            ? { ok: false, reason: "session_configuration_missing" }
            : { ok: false, reason: "two_factor_required", challengeToken };
    }

    return createBrowserSessionForUser(user.id, input);
};
