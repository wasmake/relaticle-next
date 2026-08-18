import {
    decryptLaravelCookieWithKeys,
    type LaravelAppKeyInput,
} from "./laravel-encrypter";
import { ulidSchema, type Ulid } from "../../ids";

const SESSION_ID_PATTERN = /^[A-Za-z0-9]{40}$/u;

export type LegacySessionRecord = Readonly<{
    id: string;
    userId: string | null;
    lastActivity: number;
}>;

export type ResolvedLegacySession = Readonly<{
    sessionId: string;
    userId: Ulid;
}>;

export type FindLegacySession = (
    sessionId: string,
) => Promise<LegacySessionRecord | undefined>;

type ResolveLegacySessionInput = Readonly<{
    cookieName: string;
    encryptedCookieValue: string;
    appKeys: readonly LaravelAppKeyInput[];
    lifetimeMinutes: number;
    now?: Date;
}>;

export const resolveLegacySession = async (
    input: ResolveLegacySessionInput,
    findSession: FindLegacySession,
): Promise<ResolvedLegacySession | undefined> => {
    if (!Number.isSafeInteger(input.lifetimeMinutes) || input.lifetimeMinutes < 1) {
        throw new Error("Session lifetime must be a positive integer.");
    }

    let sessionId: string;

    try {
        sessionId = decryptLaravelCookieWithKeys(
            input.cookieName,
            input.encryptedCookieValue,
            input.appKeys,
        );
    } catch {
        return undefined;
    }

    if (!SESSION_ID_PATTERN.test(sessionId)) {
        return undefined;
    }

    const session = await findSession(sessionId);
    const expiryCutoff = Math.floor(
        (input.now ?? new Date()).getTime() / 1_000 -
            input.lifetimeMinutes * 60,
    );

    if (
        session === undefined ||
        session.id !== sessionId ||
        session.userId === null ||
        session.lastActivity < expiryCutoff
    ) {
        return undefined;
    }

    const userId = ulidSchema.safeParse(session.userId);

    if (!userId.success) {
        return undefined;
    }

    return { sessionId, userId: userId.data };
};
