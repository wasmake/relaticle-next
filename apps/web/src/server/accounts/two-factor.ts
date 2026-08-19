import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";

import { decryptLaravelString, encryptLaravelString } from "@/server/auth/compatibility/laravel-encrypter";
import { generateRecoveryCodes, generateTotpSecret, totpStep } from "@/server/auth/totp";
import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { getEnvironment } from "@/server/env";
import type { Ulid } from "@/server/ids";

const key = (): string => {
    const value = getEnvironment().APP_KEY;
    if (value === undefined) throw new Error("APP_KEY is required for two-factor authentication.");
    return value;
};
const encrypt = (value: string): string => encryptLaravelString(value, key());
const decrypt = (value: string): string => decryptLaravelString(value, key());

export const twoFactorState = async (userId: Ulid): Promise<Readonly<{ enabled: boolean; pendingSecret?: string }>> => {
    const [user] = await getDatabase().select({ secret: users.twoFactorSecret, confirmed: users.twoFactorConfirmedAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (user?.secret === null || user === undefined) return { enabled: false };
    return user.confirmed === null ? { enabled: false, pendingSecret: decrypt(user.secret) } : { enabled: true };
};

export const beginTwoFactorSetup = async (userId: Ulid): Promise<void> => {
    await getDatabase().update(users).set({ twoFactorSecret: encrypt(generateTotpSecret()), twoFactorRecoveryCodes: null, twoFactorConfirmedAt: null, updatedAt: new Date() }).where(and(eq(users.id, userId), isNull(users.twoFactorSecret), isNull(users.twoFactorConfirmedAt)));
};

export const confirmTwoFactorSetup = async (userId: Ulid, code: string): Promise<readonly string[] | undefined> => {
    const database = getDatabase();
    const [user] = await database.select({ secret: users.twoFactorSecret, confirmed: users.twoFactorConfirmedAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.secret || user.confirmed !== null) return undefined;
    const step = totpStep(decrypt(user.secret), code);
    if (step === undefined) return undefined;
    const recoveryCodes = generateRecoveryCodes();
    const updated = await database.update(users).set({ twoFactorRecoveryCodes: encrypt(JSON.stringify(recoveryCodes)), twoFactorConfirmedAt: new Date(), twoFactorLastUsedStep: step, updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.twoFactorSecret, user.secret), isNull(users.twoFactorConfirmedAt))).returning({ id: users.id });
    return updated.length === 1 ? recoveryCodes : undefined;
};

export const disableTwoFactor = async (userId: Ulid, code: string): Promise<boolean> => {
    if (!(await verifyTwoFactorChallenge(userId, code, false))) return false;
    await getDatabase().update(users).set({ twoFactorSecret: null, twoFactorRecoveryCodes: null, twoFactorConfirmedAt: null, twoFactorLastUsedStep: null, updatedAt: new Date() }).where(eq(users.id, userId));
    return true;
};

export const verifyTwoFactorChallenge = async (userId: Ulid, code: string, consumeRecovery = true): Promise<boolean> => {
    const database = getDatabase();
    const [user] = await database.select({ secret: users.twoFactorSecret, recovery: users.twoFactorRecoveryCodes, confirmed: users.twoFactorConfirmedAt, lastUsedStep: users.twoFactorLastUsedStep }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.secret || user.confirmed === null) return false;
    const step = totpStep(decrypt(user.secret), code);
    if (step !== undefined) {
        const consumed = await database.update(users).set({ twoFactorLastUsedStep: step, updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.twoFactorSecret, user.secret), isNotNull(users.twoFactorConfirmedAt), or(isNull(users.twoFactorLastUsedStep), lt(users.twoFactorLastUsedStep, step)))).returning({ id: users.id });
        return consumed.length === 1;
    }
    if (!user.recovery) return false;
    let recovery: unknown;
    try { recovery = JSON.parse(decrypt(user.recovery)); } catch { return false; }
    if (!Array.isArray(recovery) || !recovery.every((candidate) => typeof candidate === "string")) return false;
    const normalized = code.trim().toLowerCase();
    const index = recovery.findIndex((candidate) => candidate.toLowerCase() === normalized);
    if (index < 0) return false;
    if (consumeRecovery) {
        recovery.splice(index, 1);
        const updated = await database.update(users).set({ twoFactorRecoveryCodes: encrypt(JSON.stringify(recovery)), updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.twoFactorRecoveryCodes, user.recovery))).returning({ id: users.id });
        if (updated.length !== 1) return false;
    }
    return true;
};
