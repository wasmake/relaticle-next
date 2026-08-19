import { createHmac, timingSafeEqual } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { getEnvironment } from "@/server/env";
import { ulidSchema, type Ulid } from "@/server/ids";

const signingKey = (): string | undefined => getEnvironment().APP_KEY;
const signatureFor = (payload: string, key: string): string =>
    createHmac("sha256", key).update(payload).digest("base64url");

export const createEmailVerificationToken = (userId: Ulid, email: string, expiresAt = Date.now() + 24 * 60 * 60 * 1_000): string | undefined => {
    const key = signingKey();
    if (key === undefined) return undefined;
    const payload = Buffer.from(JSON.stringify({ userId, email, expiresAt })).toString("base64url");
    return `${payload}.${signatureFor(payload, key)}`;
};

export const verifyEmailToken = async (token: string, now = Date.now()): Promise<boolean> => {
    const key = signingKey();
    const [payload, supplied] = token.split(".");
    if (key === undefined || payload === undefined || supplied === undefined) return false;
    const expected = signatureFor(payload, key);
    if (expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return false;

    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return false; }
    if (typeof decoded !== "object" || decoded === null) return false;
    const value = decoded as Record<string, unknown>;
    const userId = ulidSchema.safeParse(value.userId);
    if (!userId.success || typeof value.email !== "string" || typeof value.expiresAt !== "number" || value.expiresAt <= now) return false;

    const result = await getDatabase().update(users).set({ emailVerifiedAt: new Date(now), updatedAt: new Date(now) }).where(and(eq(users.id, userId.data), eq(users.email, value.email))).returning({ id: users.id });
    return result.length === 1;
};
