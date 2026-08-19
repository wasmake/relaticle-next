import { and, desc, eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { activityLog, users } from "@/server/db/schema";
import type { Ulid } from "@/server/ids";

import type { ActivitySubjectType } from "./writer";

export type ActivityTimelineItem = Readonly<{
    id: string;
    event: string;
    description: string;
    actor: string;
    changes: unknown;
    properties: unknown;
    details: readonly string[];
    createdAt: string | null;
}>;

type ActivityRow = Readonly<{
    id: string;
    batchUuid: string | null;
    event: string;
    description: string;
    actor: string;
    changes: unknown;
    properties: unknown;
    createdAt: string | null;
}>;

const object = (value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};

const detailsFor = (row: ActivityRow): readonly string[] => {
    const changes = object(row.changes);
    const attributes = object(changes.attributes);
    const old = object(changes.old);
    const native = Object.entries(attributes).map(([name, value]) => `${name}: ${String(old[name] ?? "empty")} -> ${String(value ?? "empty")}`);
    const custom = Array.isArray(object(row.properties).custom_field_changes) ? object(row.properties).custom_field_changes as readonly unknown[] : [];
    return [...native, ...custom.map((change) => {
        const item = object(change);
        return `${String(item.label ?? item.code ?? "Custom field")}: ${String(object(item.old).label ?? "empty")} -> ${String(object(item.new).label ?? "empty")}`;
    })];
};

export const mergeActivityBatches = (rows: readonly ActivityRow[]): readonly ActivityTimelineItem[] => {
    const batches = new Map<string, ActivityTimelineItem>();
    for (const row of rows) {
        const key = row.batchUuid ?? `row:${row.id}`;
        const existing = batches.get(key);
        const details = detailsFor(row);
        if (existing === undefined) {
            batches.set(key, { id: row.id, event: row.event, description: row.description, actor: row.actor, changes: row.changes, properties: row.properties, details, createdAt: row.createdAt });
        } else {
            batches.set(key, { ...existing, event: existing.event === "custom_field_changes" ? row.event : existing.event, details: [...existing.details, ...details] });
        }
    }
    return [...batches.values()];
};

export const getActivityTimeline = async (
    teamId: Ulid,
    subjectType: ActivitySubjectType,
    subjectId: Ulid,
): Promise<readonly ActivityTimelineItem[]> => {
    const rows = await getDatabase()
        .select({
            id: activityLog.id,
            batchUuid: activityLog.batchUuid,
            event: activityLog.event,
            description: activityLog.description,
            actor: users.name,
            changes: activityLog.attributeChanges,
            properties: activityLog.properties,
            createdAt: activityLog.createdAt,
        })
        .from(activityLog)
        .leftJoin(users, eq(users.id, activityLog.causerId))
        .where(and(
            eq(activityLog.teamId, teamId),
            eq(activityLog.subjectType, subjectType),
            eq(activityLog.subjectId, subjectId),
        ))
        .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
        .limit(100);

    return mergeActivityBatches(rows.map((row) => ({
        id: row.id.toString(),
        batchUuid: row.batchUuid,
        event: row.event ?? row.description,
        description: row.description,
        actor: row.actor ?? "A workspace member",
        changes: row.changes,
        properties: row.properties,
        createdAt: row.createdAt?.toISOString() ?? null,
    })));
};
