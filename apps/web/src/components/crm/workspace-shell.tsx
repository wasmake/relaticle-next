import Link from "next/link";
import type { ReactNode } from "react";

import type { CrmResource } from "@/app/app/[teamSlug]/_crm-data";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { chatService } from "@/server/chat/production";

import styles from "./crm.module.css";
import { GlobalSearch } from "./global-search";
import { CrmIcon, type CrmIconName } from "./icon";

const resources: readonly Readonly<{ slug: CrmResource; label: string; icon: CrmIconName }>[] = [
    { slug: "people", label: "People", icon: "people" },
    { slug: "companies", label: "Companies", icon: "building" },
    { slug: "opportunities", label: "Opportunities", icon: "trophy" },
    { slug: "tasks", label: "Tasks", icon: "task" },
    { slug: "notes", label: "Notes", icon: "note" },
];

type WorkspaceShellProperties = Readonly<{
    teamSlug: string;
    teamName: string;
    active: CrmResource | "chat" | "overview" | "settings";
    children: ReactNode;
}>;

const initials = (value: string): string => value
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const WorkspaceShell = async ({ teamSlug, teamName, active, children }: WorkspaceShellProperties) => {
    const authentication = await requireBrowserTeam(teamSlug);
    const conversations = await chatService.listConversations(authentication.context);
    const visibleConversations = conversations.slice(0, 7);

    return (
        <main className={styles.workspace}>
            <input className={styles.sidebarToggle} id="workspace-sidebar-toggle" type="checkbox" />
            <header className={styles.mobileTopbar}>
                <details>
                    <summary aria-label="Open navigation">☰</summary>
                    <div className={styles.mobileDrawer}>
                        <nav aria-label="Workspace">
                            <Link href={`/app/${teamSlug}`}>Home</Link>
                            {resources.map(({ label, slug }) => <Link key={slug} href={`/app/${teamSlug}/${slug}`}>{label}</Link>)}
                        </nav>
                    </div>
                </details>
                <strong>{teamName}</strong>
                <Link href="/app/settings/profile" className={styles.avatar} aria-label="Account settings">{initials(authentication.user.name)}</Link>
            </header>
            <aside className={styles.sidebar}>
                <details className={styles.tenantMenu}>
                    <summary className={styles.tenant}>
                        <span>{initials(teamName)}</span>
                        <strong>{teamName}</strong>
                        <CrmIcon name="chevron" />
                    </summary>
                    <nav aria-label="Workspace menu">
                        <Link href={`/app/${teamSlug}/settings/team`}>Workspace settings</Link>
                        <Link href={`/app/${teamSlug}/settings/custom-fields`}>Custom fields</Link>
                        <Link href={`/app/${teamSlug}/billing`}>Billing</Link>
                        <Link href={`/app/${teamSlug}/settings/api-tokens`}>API tokens</Link>
                        <Link href="/app/new">Switch workspace</Link>
                    </nav>
                </details>
                <div className={styles.sidebarTools}>
                    <GlobalSearch teamSlug={teamSlug} />
                    <Link href="/app/settings/notifications" className={styles.notificationButton} aria-label="Notifications"><CrmIcon name="inbox" /></Link>
                </div>
                <nav aria-label="Workspace" className={styles.navigation}>
                    <Link href={`/app/${teamSlug}`} aria-current={active === "overview" ? "page" : undefined}><CrmIcon name="dashboard" /><span>Home</span></Link>
                    {resources.map(({ icon, label, slug }) => (
                        <Link key={slug} href={`/app/${teamSlug}/${slug}`} aria-current={active === slug ? "page" : undefined}>
                            <CrmIcon name={icon} /><span>{label}</span>
                        </Link>
                    ))}
                    <section className={styles.chatNavigation}>
                        <header><span>Chats</span><CrmIcon name="chevron" /></header>
                        {visibleConversations.length === 0 ? <p>No chats yet. Start one from Home.</p> : visibleConversations.map((conversation) => (
                            <Link key={conversation.id} href={`/app/${teamSlug}/chat?conversation=${conversation.id}`} title={conversation.title}>
                                <CrmIcon name="chat" /><span>{conversation.title || "Untitled chat"}</span>
                            </Link>
                        ))}
                        {conversations.length > 7 ? <Link className={styles.allChats} href={`/app/${teamSlug}/chat`}><CrmIcon name="dots" /><span>All chats</span></Link> : null}
                    </section>
                </nav>
            </aside>
            <section className={styles.mainColumn}>
                <header className={styles.topbar}>
                    <label className={styles.sidebarToggleLabel} htmlFor="workspace-sidebar-toggle" aria-label="Collapse sidebar"><CrmIcon name="chevron" /></label>
                    <div className={styles.topbarActions}>
                        <Link href={`/app/${teamSlug}/chat`} className={styles.askRelaticle}><CrmIcon name="chat" />Ask Relaticle</Link>
                        <details className={styles.userMenu}>
                            <summary className={styles.avatar} aria-label="Account settings">{initials(authentication.user.name)}</summary>
                            <nav aria-label="Account menu"><strong>{authentication.user.name}</strong><small>{authentication.user.email}</small><Link href="/app/settings/profile">Profile</Link><Link href="/app/settings/security">Security</Link><Link href="/app/settings/notifications">Notifications</Link><form method="post" action="/auth/logout"><button type="submit">Sign out</button></form></nav>
                        </details>
                    </div>
                </header>
                <section className={styles.content}>{children}</section>
            </section>
        </main>
    );
};
