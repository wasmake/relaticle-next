import type { Metadata } from "next";
import Link from "next/link";

import { DocumentationShell, styles } from "../_components/documentation";
import { documentationCategories, pagesInCategory } from "@/server/documentation/content";

export const metadata: Metadata = {
    title: "Help Centre - Relaticle",
    description: "Guides for setting up your workspace and using Relaticle day to day.",
};

const HelpPage = () => (
    <DocumentationShell>
        <p className={styles.eyebrow}>Relaticle docs</p>
        <h1 className={styles.title}>How can we help?</h1>
        <p className={styles.description}>
            Guides for setting up your workspace, importing records, and using Relaticle day to day.
        </p>
        <div className={styles.grid}>
            {documentationCategories.filter((category) => category.area === "help").map((category) => (
                <Link className={styles.card} href={`/help/${category.slug}`} key={category.path}>
                    <h2>{category.title}</h2>
                    <p>{category.description}</p>
                    <span>{pagesInCategory("help", category.slug).length} articles</span>
                </Link>
            ))}
        </div>
    </DocumentationShell>
);

export default HelpPage;
