import Link from "next/link";

import { requireBrowserUser } from "@/server/auth/browser/context";
import { getNotificationCenter } from "@/server/notifications/service";

import { NotificationSettings } from "./notification-settings";

const NotificationsPage = async () => {
    const identity = await requireBrowserUser();
    const center = await getNotificationCenter(identity.userId);
    return <main className="account-page"><nav className="account-nav" aria-label="Account settings"><Link href="/app/new" className="wordmark">Relaticle</Link><Link href="/app/settings/profile">Profile</Link><Link href="/app/settings/security">Security</Link><Link href="/app/settings/notifications" aria-current="page">Notifications</Link></nav><section className="account-content"><p className="eyebrow">Account settings</p><h1>Notifications</h1><NotificationSettings initialPreferences={center.preferences} initialItems={center.items} /></section></main>;
};
export default NotificationsPage;
