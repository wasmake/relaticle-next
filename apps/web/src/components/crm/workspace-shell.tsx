import Link from "next/link";
import type { ReactNode } from "react";

import type { CrmResource } from "@/app/app/[teamSlug]/_crm-data";

import styles from "./crm.module.css";
import { GlobalSearch } from "./global-search";
import { NotificationLink } from "./notification-link";

const resources: readonly Readonly<{ slug: CrmResource; label: string }>[] = [
    { slug: "companies", label: "Companies" },
    { slug: "people", label: "People" },
    { slug: "opportunities", label: "Opportunities" },
    { slug: "tasks", label: "Tasks" },
    { slug: "notes", label: "Notes" },
];

type WorkspaceShellProperties = Readonly<{
    teamSlug: string;
    teamName: string;
    active: CrmResource | "chat";
    children: ReactNode;
}>;

export const WorkspaceShell = ({
    teamSlug,
    teamName,
    active,
    children,
}: WorkspaceShellProperties) => (
    <main className={styles.workspace}>
        <aside className={styles.sidebar}>
            <Link href={`/app/${teamSlug}`} className={styles.wordmark}>Relaticle</Link>
            <p className={styles.teamName}>{teamName}</p>
            <GlobalSearch teamSlug={teamSlug} />
            <nav aria-label="Workspace" className={styles.navigation}>
                <Link href={`/app/${teamSlug}`}>Overview</Link>
                <Link
                    href={`/app/${teamSlug}/chat`}
                    aria-current={active === "chat" ? "page" : undefined}
                >
                    AI Assistant
                </Link>
                {resources.map(({ label, slug }) => (
                    <Link
                        key={slug}
                        href={`/app/${teamSlug}/${slug}`}
                        aria-current={active === slug ? "page" : undefined}
                    >
                        {label}
                    </Link>
                ))}
                <Link href={`/app/${teamSlug}/settings/custom-fields`}>Custom fields</Link>
                <Link href={`/app/${teamSlug}/settings/api-tokens`}>API tokens</Link>
                <NotificationLink />
                <Link href={`/app/${teamSlug}/billing`}>Billing</Link>
            </nav>
        </aside>
        <section className={styles.content}>{children}</section>
    </main>
);
