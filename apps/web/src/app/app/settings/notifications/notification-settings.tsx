"use client";

import { useState } from "react";

import type { NotificationPreferences } from "@/server/notifications/service";

type Item = Readonly<{ id: string; type: string; data: unknown; readAt: Date | null; createdAt: Date | null }>;
export const NotificationSettings = ({ initialPreferences, initialItems }: { initialPreferences: NotificationPreferences; initialItems: readonly Item[] }) => {
    const [preferences, setPreferences] = useState(initialPreferences);
    const [items, setItems] = useState(initialItems);
    const [message, setMessage] = useState("");
    const update = async (body: unknown) => {
        const response = await fetch("/auth/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) { setMessage("The change could not be saved."); return; }
        const result = await response.json() as { data: { preferences: NotificationPreferences; items: Item[] } };
        setPreferences(result.data.preferences); setItems(result.data.items); setMessage("Saved.");
    };
    return <div className="account-grid"><article className="account-panel"><h2>Delivery</h2><label className="check-row"><input type="checkbox" checked={preferences.email} onChange={(event) => void update({ action: "preferences", email: event.target.checked, inApp: preferences.inApp })} /> Email notifications</label><label className="check-row"><input type="checkbox" checked={preferences.inApp} onChange={(event) => void update({ action: "preferences", email: preferences.email, inApp: event.target.checked })} /> In-app notifications</label><p role="status">{message}</p></article><article className="account-panel"><header className="panel-heading"><h2>Inbox</h2><button type="button" onClick={() => void update({ action: "read" })}>Mark all read</button></header>{items.length === 0 ? <p>No notifications yet.</p> : <ul className="notification-list">{items.map((item) => <li key={item.id} data-read={item.readAt === null ? "false" : "true"}><strong>{item.type}</strong><span>{JSON.stringify(item.data)}</span>{item.readAt === null ? <button type="button" onClick={() => void update({ action: "read", ids: [item.id] })}>Mark read</button> : null}</li>)}</ul>}</article></div>;
};
