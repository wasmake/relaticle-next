import Link from "next/link";

import { requireBrowserUser } from "@/server/auth/browser/context";

const ProfilePage = async ({ searchParams }: { searchParams: Promise<{ updated?: string; error?: string }> }) => {
    const identity = await requireBrowserUser();
    const state = await searchParams;
    return <main className="account-page"><nav className="account-nav" aria-label="Account settings"><Link href="/app/new" className="wordmark">Relaticle</Link><Link href="/app/settings/profile" aria-current="page">Profile</Link><Link href="/app/settings/security">Security</Link><Link href="/app/settings/notifications">Notifications</Link></nav><section className="account-content"><p className="eyebrow">Account settings</p><h1>Your profile</h1><div className="account-grid"><article className="account-panel">{state.updated === "1" ? <p role="status">Profile updated.</p> : null}{state.error === undefined ? null : <p className="form-error" role="alert">The profile could not be updated.</p>}<form className="stack-form" method="post" action="/auth/profile"><label htmlFor="name">Name</label><input id="name" name="name" defaultValue={identity.user.name} required /><label htmlFor="email">Email address</label><input id="email" name="email" type="email" defaultValue={identity.user.email} required /><button type="submit">Save profile</button></form></article><article className="account-panel"><h2>Delete account</h2><p>Schedule your account and owned workspaces for permanent deletion in 30 days.</p><form method="post" action="/auth/account-deletion"><button className="danger-button" name="intent" value="schedule">Schedule deletion</button></form></article></div></section></main>;
};
export default ProfilePage;
