import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createHttpAuthConfiguration } from "@/server/auth/http/configuration";
import { DrizzleHttpAuthRepository } from "@/server/auth/http/drizzle-repository";
import { resolveHttpAuth, resolveHttpIdentity } from "@/server/auth/http/resolver";
import { getDatabase } from "@/server/db/client";
import { teams } from "@/server/db/schema";

export const requireBrowserTeam = async (teamSlug: string) => {
    const database = getDatabase();
    const [team] = await database
        .select({ id: teams.id })
        .from(teams)
        .where(and(eq(teams.slug, teamSlug), isNull(teams.scheduledDeletionAt)))
        .limit(1);

    if (team === undefined) {
        redirect("/app/login");
    }

    const requestHeaders = new Headers(await headers());
    requestHeaders.set("x-team-id", team.id);
    const result = await resolveHttpAuth(
        {
            request: { method: "GET", headers: requestHeaders },
            requestId: randomUUID(),
        },
        new DrizzleHttpAuthRepository(database),
        createHttpAuthConfiguration(),
    );

    if (!result.ok) {
        redirect(`/app/login?next=${encodeURIComponent(`/app/${teamSlug}`)}`);
    }

    return result;
};

export const requireBrowserUser = async () => {
    const database = getDatabase();
    const result = await resolveHttpIdentity(
        {
            request: { method: "GET", headers: new Headers(await headers()) },
            requestId: randomUUID(),
        },
        new DrizzleHttpAuthRepository(database),
        createHttpAuthConfiguration(),
    );

    if (!result.ok) {
        redirect("/app/login");
    }

    return result;
};
