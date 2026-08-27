import Link from "next/link";
import type { ReactNode } from "react";

import type { CrmResource } from "@/app/app/[teamSlug]/_crm-data";

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

export const WorkspaceShell = ({
    teamSlug,
    teamName,
    active,
    children,
}: WorkspaceShellProperties) => (
    <main className={styles.workspace}>
        <header className={styles.mobileTopbar}>
            <details>
                <summary aria-label="Open navigation">☰</summary>
                <div className={styles.mobileDrawer}>
                    <nav aria-label="Workspace">
                        <Link href={`/app/${teamSlug}`}>Dashboard</Link>
                        <Link href={`/app/${teamSlug}/chat`}>AI Assistant</Link>
                        {resources.map(({ label, slug }) => <Link key={slug} href={`/app/${teamSlug}/${slug}`}>{label}</Link>)}
                        <Link href={`/app/${teamSlug}/settings/custom-fields`}>Custom Fields</Link>
                    </nav>
                </div>
            </details>
            <strong>{teamName}</strong>
            <Link href="/app/settings/profile" className={styles.avatar} aria-label="Account settings">A</Link>
        </header>
        <aside className={styles.sidebar}>
            <Link href={`/app/${teamSlug}`} className={styles.tenant}>
                <span>{teamName.split(/\s+/u).map((word) => word[0]).join("").slice(0, 2).toUpperCase()}</span>
                <strong>{teamName}</strong>
                <CrmIcon name="chevron" />
            </Link>
            <div className={styles.sidebarTools}>
                <GlobalSearch teamSlug={teamSlug} />
                <Link href="/app/settings/notifications" className={styles.notificationButton} aria-label="Notifications"><CrmIcon name="bell" /></Link>
            </div>
            <nav aria-label="Workspace" className={styles.navigation}>
                <p>Workspace</p>
                <Link href={`/app/${teamSlug}`} aria-current={active === "overview" ? "page" : undefined}><CrmIcon name="dashboard" /><span>Dashboard</span></Link>
                <Link
                    href={`/app/${teamSlug}/chat`}
                    aria-current={active === "chat" ? "page" : undefined}
                >
                    <CrmIcon name="assistant" /><span>AI Assistant</span>
                </Link>
                {resources.map(({ icon, label, slug }) => (
                    <Link
                        key={slug}
                        href={`/app/${teamSlug}/${slug}`}
                        aria-current={active === slug ? "page" : undefined}
                    >
                        <CrmIcon name={icon} /><span>{label}</span>
                    </Link>
                ))}
                <p>Custom Fields</p>
                <Link href={`/app/${teamSlug}/settings/custom-fields`}><CrmIcon name="cube" /><span>Custom Fields</span></Link>
            </nav>
            <nav aria-label="Workspace settings" className={styles.sidebarFooter}>
                <Link href={`/app/${teamSlug}/settings/team`}>Workspace settings</Link>
                <Link href={`/app/${teamSlug}/settings/api-tokens`}>API tokens</Link>
                <Link href={`/app/${teamSlug}/billing`}>Billing</Link>
            </nav>
        </aside>
        <section className={styles.mainColumn}>
            <header className={styles.topbar}>
                <button type="button" aria-label="Collapse sidebar"><CrmIcon name="chevron" /></button>
                <Link href="/app/settings/profile" className={styles.avatar} aria-label="Account settings">A</Link>
            </header>
            <section className={styles.content}>{children}</section>
        </section>
    </main>
);
