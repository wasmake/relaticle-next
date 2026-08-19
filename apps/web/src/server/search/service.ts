import { and, desc, eq, ilike, isNull, or } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { companies, notes, opportunities, people, tasks } from "@/server/db/schema";
import type { Ulid } from "@/server/ids";

export type SearchResult = Readonly<{
    id: string;
    resource: "companies" | "people" | "opportunities" | "tasks" | "notes";
    title: string;
    context: string;
}>;

export const searchWorkspace = async (
    teamId: Ulid,
    query: string,
    limit = 8,
): Promise<readonly SearchResult[]> => {
    const term = query.trim();
    if (term.length < 2) return [];

    const database = getDatabase();
    const pattern = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const [companyRows, peopleRows, opportunityRows, taskRows, noteRows] = await Promise.all([
        database.select({ id: companies.id, title: companies.name, createdAt: companies.createdAt })
            .from(companies).where(and(eq(companies.teamId, teamId), isNull(companies.deletedAt), ilike(companies.name, pattern))).orderBy(desc(companies.updatedAt)).limit(limit),
        database.select({ id: people.id, title: people.name, company: companies.name, createdAt: people.createdAt })
            .from(people).leftJoin(companies, and(eq(companies.id, people.companyId), eq(companies.teamId, teamId)))
            .where(and(eq(people.teamId, teamId), isNull(people.deletedAt), or(ilike(people.name, pattern), ilike(companies.name, pattern)))).orderBy(desc(people.updatedAt)).limit(limit),
        database.select({ id: opportunities.id, title: opportunities.name, company: companies.name, createdAt: opportunities.createdAt })
            .from(opportunities).leftJoin(companies, and(eq(companies.id, opportunities.companyId), eq(companies.teamId, teamId)))
            .where(and(eq(opportunities.teamId, teamId), isNull(opportunities.deletedAt), or(ilike(opportunities.name, pattern), ilike(companies.name, pattern)))).orderBy(desc(opportunities.updatedAt)).limit(limit),
        database.select({ id: tasks.id, title: tasks.title, createdAt: tasks.createdAt })
            .from(tasks).where(and(eq(tasks.teamId, teamId), isNull(tasks.deletedAt), ilike(tasks.title, pattern))).orderBy(desc(tasks.updatedAt)).limit(limit),
        database.select({ id: notes.id, title: notes.title, createdAt: notes.createdAt })
            .from(notes).where(and(eq(notes.teamId, teamId), isNull(notes.deletedAt), ilike(notes.title, pattern))).orderBy(desc(notes.updatedAt)).limit(limit),
    ]);
    const context = (date: Date | null): string => date === null ? "" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date);

    return [
        ...companyRows.map((row) => ({ id: row.id, resource: "companies" as const, title: row.title, context: context(row.createdAt) })),
        ...peopleRows.map((row) => ({ id: row.id, resource: "people" as const, title: row.title, context: row.company ?? context(row.createdAt) })),
        ...opportunityRows.map((row) => ({ id: row.id, resource: "opportunities" as const, title: row.title, context: row.company ?? context(row.createdAt) })),
        ...taskRows.map((row) => ({ id: row.id, resource: "tasks" as const, title: row.title, context: context(row.createdAt) })),
        ...noteRows.map((row) => ({ id: row.id, resource: "notes" as const, title: row.title, context: context(row.createdAt) })),
    ].sort((left, right) => left.title.localeCompare(right.title)).slice(0, limit);
};
