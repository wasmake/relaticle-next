import type { Metadata } from "next";
import Link from "next/link";

import { DocumentationShell, PageGrid, styles } from "../_components/documentation";
import { pagesInCategory } from "@/server/documentation/content";

export const metadata: Metadata = {
    title: "Developer Documentation - Relaticle",
    description: "Deploy, extend, and contribute to Relaticle.",
};

const DevelopersPage = () => (
    <DocumentationShell>
        <p className={styles.eyebrow}>Build on Relaticle</p>
        <h1 className={styles.title}>Developer Documentation</h1>
        <p className={styles.description}>
            Self-host Relaticle, contribute to the project, and connect AI agents over MCP.
        </p>
        <PageGrid pages={pagesInCategory("docs", "guides")} />
        <div className={styles.grid}>
            <Link className={styles.card} href="/developers/api">
                <h2>API Reference</h2>
                <p>REST API documentation for managing CRM entities.</p>
                <span>View endpoints</span>
            </Link>
        </div>
    </DocumentationShell>
);

export default DevelopersPage;
