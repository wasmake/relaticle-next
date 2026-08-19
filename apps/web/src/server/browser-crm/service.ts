import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";

import type { CrmResource } from "@/app/app/[teamSlug]/_crm-data";
import type { RequestContext } from "@/server/context/request-context";
import { getDatabase } from "@/server/db/client";
import { activityLog, companies, notes, opportunities, people, tasks } from "@/server/db/schema";
import type { Ulid } from "@/server/ids";

const tableFor = (resource: CrmResource) => {
    if (resource === "companies") return companies;
    if (resource === "people") return people;
    if (resource === "opportunities") return opportunities;
    if (resource === "tasks") return tasks;
    return notes;
};

const subjectFor = (resource: CrmResource): "company" | "people" | "opportunity" | "task" | "note" =>
    resource === "companies" ? "company" : resource === "opportunities" ? "opportunity" : resource === "tasks" ? "task" : resource === "notes" ? "note" : "people";

export type TrashRecord = Readonly<{ id: string; title: string; deletedAt: string }>;

export const listTrash = async (teamId: Ulid, resource: CrmResource): Promise<readonly TrashRecord[]> => {
    const database = getDatabase();
    const rows = resource === "companies"
        ? await database.select({ id: companies.id, title: companies.name, deletedAt: companies.deletedAt }).from(companies).where(and(eq(companies.teamId, teamId), isNotNull(companies.deletedAt))).orderBy(desc(companies.deletedAt)).limit(100)
        : resource === "people"
          ? await database.select({ id: people.id, title: people.name, deletedAt: people.deletedAt }).from(people).where(and(eq(people.teamId, teamId), isNotNull(people.deletedAt))).orderBy(desc(people.deletedAt)).limit(100)
          : resource === "opportunities"
            ? await database.select({ id: opportunities.id, title: opportunities.name, deletedAt: opportunities.deletedAt }).from(opportunities).where(and(eq(opportunities.teamId, teamId), isNotNull(opportunities.deletedAt))).orderBy(desc(opportunities.deletedAt)).limit(100)
            : resource === "tasks"
              ? await database.select({ id: tasks.id, title: tasks.title, deletedAt: tasks.deletedAt }).from(tasks).where(and(eq(tasks.teamId, teamId), isNotNull(tasks.deletedAt))).orderBy(desc(tasks.deletedAt)).limit(100)
              : await database.select({ id: notes.id, title: notes.title, deletedAt: notes.deletedAt }).from(notes).where(and(eq(notes.teamId, teamId), isNotNull(notes.deletedAt))).orderBy(desc(notes.deletedAt)).limit(100);
    return rows.flatMap((row) => row.deletedAt === null ? [] : [{ id: row.id, title: row.title, deletedAt: row.deletedAt.toISOString() }]);
};

export const restoreRecord = async (context: RequestContext, resource: CrmResource, id: Ulid): Promise<boolean> => {
    const table = tableFor(resource);
    const now = new Date();
    return getDatabase().transaction(async (transaction) => {
        const restored = await transaction.update(table).set({ deletedAt: null, updatedAt: now })
            .where(and(eq(table.id, id), eq(table.teamId, context.teamId), isNotNull(table.deletedAt))).returning({ id: table.id });
        if (restored.length === 0) return false;
        await transaction.insert(activityLog).values({ teamId: context.teamId, logName: "crm", description: "restored", subjectType: subjectFor(resource), subjectId: id, event: "restored", causerType: "user", causerId: context.userId, attributeChanges: {}, properties: {}, batchUuid: crypto.randomUUID(), createdAt: now, updatedAt: now });
        return true;
    });
};

export const updateBoardOrder = async (context: RequestContext, resource: "opportunities" | "tasks", ids: readonly Ulid[]): Promise<void> => {
    const table = resource === "opportunities" ? opportunities : tasks;
    await getDatabase().transaction(async (transaction) => {
        for (const [index, id] of ids.entries()) {
            await transaction.update(table).set({ orderColumn: (index + 1).toString(), updatedAt: new Date() }).where(and(eq(table.id, id), eq(table.teamId, context.teamId), isNull(table.deletedAt)));
        }
    });
};

export const orderedActiveIds = async (teamId: Ulid, resource: "opportunities" | "tasks"): Promise<readonly Ulid[]> => {
    const table = resource === "opportunities" ? opportunities : tasks;
    const rows = await getDatabase().select({ id: table.id }).from(table).where(and(eq(table.teamId, teamId), isNull(table.deletedAt))).orderBy(asc(table.orderColumn), asc(table.createdAt));
    return rows.map(({ id }) => id);
};
