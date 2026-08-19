import { createHmac, timingSafeEqual } from "node:crypto";

import { getEnvironment } from "@/server/env";

const signature = (payload: string, key: string): string =>
    createHmac("sha256", key).update(payload).digest("base64url");

export const createSignedToken = (value: Readonly<Record<string, unknown>>): string | undefined => {
    const key = getEnvironment().APP_KEY;
    if (key === undefined) return undefined;
    const payload = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    return `${payload}.${signature(payload, key)}`;
};

export const readSignedToken = (token: string, now = Date.now()): Readonly<Record<string, unknown>> | undefined => {
    const key = getEnvironment().APP_KEY;
    const [payload, supplied, extra] = token.split(".");
    if (key === undefined || payload === undefined || supplied === undefined || extra !== undefined) return undefined;
    const expected = signature(payload, key);
    if (expected.length !== supplied.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) return undefined;
    try {
        const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
        const record = value as Readonly<Record<string, unknown>>;
        return typeof record.expiresAt === "number" && record.expiresAt > now ? record : undefined;
    } catch {
        return undefined;
    }
};
