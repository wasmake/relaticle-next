"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export const NotificationLink = () => {
    const [unread, setUnread] = useState(0);
    useEffect(() => { void fetch("/auth/notifications").then(async (response) => response.json() as Promise<{ items: { readAt: string | null }[] }>).then((center) => setUnread(center.items.filter((item) => item.readAt === null).length)).catch(() => undefined); }, []);
    return <Link href="/app/settings/notifications">Notifications{unread > 0 ? ` (${unread})` : ""}</Link>;
};
