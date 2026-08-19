import { eq } from "drizzle-orm";

import {
    jobOptionsFor,
    mailcoachSubscriberSyncJobName,
    mailcoachTagsModifyJobName,
} from "@queue/jobs";

import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { getEnvironment } from "@/server/env";
import type { Ulid } from "@/server/ids";
import { getQueue } from "@/server/queue/client";

export type MailcoachEvent = "registration" | "login" | "team" | "first-data" | "first-token" | "first-chat";

export const mailcoachTagFor = (event: MailcoachEvent): string => ({ registration: "registered", login: "logged-in", team: "has-team", "first-data": "created-first-data", "first-token": "created-first-token", "first-chat": "started-first-chat" })[event];

export const syncMailcoachEvent = async (userId: Ulid, event: MailcoachEvent, request: typeof fetch = fetch): Promise<void> => {
    const environment = getEnvironment();
    if (!environment.MAILCOACH_ENABLED_SUBSCRIBERS_SYNC || !environment.MAILCOACH_API_ENDPOINT || !environment.MAILCOACH_API_TOKEN) return;
    const database = getDatabase();
    const [user] = await database.select({ email: users.email, name: users.name, uuid: users.mailcoachSubscriberUuid }).from(users).where(eq(users.id, userId)).limit(1);
    if (user === undefined) return;
    const endpoint = environment.MAILCOACH_API_ENDPOINT.replace(/\/$/u, "");
    const headers = { authorization: `Bearer ${environment.MAILCOACH_API_TOKEN}`, "content-type": "application/json", accept: "application/json" };
    if (user.uuid === null) {
        const response = await request(`${endpoint}/subscribers`, { method: "POST", headers, body: JSON.stringify({ email: user.email, first_name: user.name, tags: [mailcoachTagFor(event)] }), signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(`Mailcoach subscriber creation returned HTTP ${response.status}.`);
        const body = await response.json() as { data?: { uuid?: string }; uuid?: string };
        const uuid = body.data?.uuid ?? body.uuid;
        if (uuid) await database.update(users).set({ mailcoachSubscriberUuid: uuid, updatedAt: new Date() }).where(eq(users.id, userId));
        return;
    }
    const response = await request(`${endpoint}/subscribers/${encodeURIComponent(user.uuid)}/tags`, { method: "POST", headers, body: JSON.stringify({ tags: [mailcoachTagFor(event)] }), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Mailcoach tag synchronization returned HTTP ${response.status}.`);
};

export const queueMailcoachEvent = async (userId: Ulid, event: MailcoachEvent): Promise<void> => {
    const environment = getEnvironment();
    if (!environment.MAILCOACH_ENABLED_SUBSCRIBERS_SYNC || !environment.MAILCOACH_API_ENDPOINT || !environment.MAILCOACH_API_TOKEN) return;
    const [user] = await getDatabase().select({ email: users.email, name: users.name, uuid: users.mailcoachSubscriberUuid }).from(users).where(eq(users.id, userId)).limit(1);
    if (user === undefined) return;
    const identity = `${userId}:${event}`;
    if (user.uuid === null) {
        await getQueue("default").add(mailcoachSubscriberSyncJobName, {
            version: 1, email: user.email, userId, firstName: user.name,
            tags: [mailcoachTagFor(event)], attributes: {},
        }, jobOptionsFor(mailcoachSubscriberSyncJobName, identity));
        return;
    }
    await getQueue("default").add(mailcoachTagsModifyJobName, {
        version: 1, subscriberUuid: user.uuid, tags: [mailcoachTagFor(event)], action: "add",
    }, jobOptionsFor(mailcoachTagsModifyJobName, identity));
};
