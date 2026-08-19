import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { notifications, users } from "@/server/db/schema";
import type { JsonValue } from "@/server/db/schema/shared";
import type { Ulid } from "@/server/ids";

export type NotificationPreferences = Readonly<{ email: boolean; inApp: boolean }>;
export const defaultNotificationPreferences: NotificationPreferences = { email: true, inApp: true };

const preferencesFrom = (value: JsonValue | null): NotificationPreferences => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return defaultNotificationPreferences;
    return {
        email: typeof value.email === "boolean" ? value.email : true,
        inApp: typeof value.inApp === "boolean" ? value.inApp : true,
    };
};

export const getNotificationCenter = async (userId: Ulid) => {
    const database = getDatabase();
    const [user] = await database.select({ preferences: users.notificationPreferences }).from(users).where(eq(users.id, userId)).limit(1);
    const items = await database.select().from(notifications)
        .where(and(eq(notifications.notifiableType, "user"), eq(notifications.notifiableId, userId)))
        .orderBy(desc(notifications.createdAt)).limit(100);
    return { preferences: preferencesFrom(user?.preferences ?? null), items };
};

export const updateNotificationPreferences = async (userId: Ulid, preferences: NotificationPreferences): Promise<void> => {
    await getDatabase().update(users).set({ notificationPreferences: preferences, updatedAt: new Date() }).where(eq(users.id, userId));
};

export const markNotificationsRead = async (userId: Ulid, ids?: readonly string[]): Promise<void> => {
    const scope = and(eq(notifications.notifiableType, "user"), eq(notifications.notifiableId, userId), isNull(notifications.readAt));
    await getDatabase().update(notifications).set({ readAt: new Date(), updatedAt: new Date() })
        .where(ids === undefined ? scope : and(scope, inArray(notifications.id, [...ids])));
};
