import { createHmac, timingSafeEqual } from "node:crypto";

import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDatabase } from "@/server/db/client";
import { systemAdministrators } from "@/server/db/schema/core";

export const SYSADMIN_COOKIE = "relaticle_sysadmin";
const lifetimeSeconds = 60 * 60 * 8;

export type SystemAdministratorSession = Readonly<{
    id: string;
    name: string;
    email: string;
    role: string;
    expires: number;
}>;

const key = (): string | undefined => process.env.SYSADMIN_SESSION_SECRET ?? process.env.APP_KEY;
const sign = (payload: string, secret: string): string =>
    createHmac("sha256", secret).update(payload).digest("base64url");

export const isEligibleSystemAdministrator = (administrator: Readonly<{ emailVerifiedAt: Date | null; role: string }>): boolean =>
    administrator.emailVerifiedAt !== null && ["owner", "admin", "viewer"].includes(administrator.role);

export const createSystemAdministratorToken = (
    administrator: Omit<SystemAdministratorSession, "expires">,
    now = Date.now(),
    secret = key(),
): string => {
    if (secret === undefined || secret.length < 16) {
        throw new Error("SYSADMIN_SESSION_SECRET or APP_KEY must be at least 16 characters.");
    }
    const payload = Buffer.from(JSON.stringify({
        ...administrator,
        expires: Math.floor(now / 1000) + lifetimeSeconds,
    })).toString("base64url");
    return `${payload}.${sign(payload, secret)}`;
};

export const verifySystemAdministratorToken = (
    token: string,
    now = Date.now(),
    secret = key(),
): SystemAdministratorSession | undefined => {
    if (secret === undefined || secret.length < 16) return undefined;
    const [payload, supplied, extra] = token.split(".");
    if (payload === undefined || supplied === undefined || extra !== undefined) return undefined;
    const expected = Buffer.from(sign(payload, secret));
    const actual = Buffer.from(supplied);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined;
    try {
        const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SystemAdministratorSession>;
        if (
            typeof session.id !== "string" || typeof session.name !== "string" ||
            typeof session.email !== "string" || typeof session.role !== "string" ||
            typeof session.expires !== "number" || session.expires <= now / 1000
        ) return undefined;
        return session as SystemAdministratorSession;
    } catch {
        return undefined;
    }
};

export const authenticateSystemAdministrator = async (
    email: string,
    password: string,
): Promise<Omit<SystemAdministratorSession, "expires"> | undefined> => {
    const [administrator] = await getDatabase()
        .select({ id: systemAdministrators.id, name: systemAdministrators.name, email: systemAdministrators.email, role: systemAdministrators.role, password: systemAdministrators.password, emailVerifiedAt: systemAdministrators.emailVerifiedAt })
        .from(systemAdministrators)
        .where(eq(systemAdministrators.email, email.toLocaleLowerCase()))
        .limit(1);
    if (administrator === undefined || !isEligibleSystemAdministrator(administrator) || !(await compare(password, administrator.password.replace(/^\$2y\$/u, "$2b$")))) return undefined;
    return { id: administrator.id, name: administrator.name, email: administrator.email, role: administrator.role };
};

export const setSystemAdministratorCookie = async (
    administrator: Omit<SystemAdministratorSession, "expires">,
): Promise<void> => {
    const store = await cookies();
    store.set(SYSADMIN_COOKIE, createSystemAdministratorToken(administrator), {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/sysadmin",
        maxAge: lifetimeSeconds,
    });
};

export const clearSystemAdministratorCookie = async (): Promise<void> => {
    const store = await cookies();
    store.delete(SYSADMIN_COOKIE);
};

export const currentSystemAdministrator = async (): Promise<SystemAdministratorSession | undefined> => {
    const store = await cookies();
    const token = store.get(SYSADMIN_COOKIE)?.value;
    const session = token === undefined ? undefined : verifySystemAdministratorToken(token);
    if (session === undefined) return undefined;

    const [administrator] = await getDatabase()
        .select({
            id: systemAdministrators.id,
            name: systemAdministrators.name,
            email: systemAdministrators.email,
            role: systemAdministrators.role,
            emailVerifiedAt: systemAdministrators.emailVerifiedAt,
        })
        .from(systemAdministrators)
        .where(eq(systemAdministrators.id, session.id))
        .limit(1);

    return administrator === undefined || !isEligibleSystemAdministrator(administrator)
        ? undefined
        : { ...administrator, expires: session.expires };
};

export const requireSystemAdministrator = async (): Promise<SystemAdministratorSession> => {
    const administrator = await currentSystemAdministrator();
    if (administrator === undefined) redirect("/sysadmin/login");
    return administrator;
};
