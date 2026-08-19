import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocumentationArticle, DocumentationShell, styles } from "../../_components/documentation";
import { findDocumentationPage, pagesInCategory } from "@/server/documentation/content";

type Properties = { params: Promise<{ type: string }> };

export const generateStaticParams = () => [
    ...pagesInCategory("docs", "guides").map((page) => ({ type: page.slug })),
    { type: "api" },
];

export const generateMetadata = async ({ params }: Properties): Promise<Metadata> => {
    const { type } = await params;
    if (type === "api") return { title: "API Reference - Relaticle" };
    const page = findDocumentationPage(`docs/guides/${type}`);
    return page
        ? { title: `${page.title} - Relaticle`, description: page.description }
        : {};
};

const ApiReference = () => (
    <DocumentationShell>
        <p className={styles.eyebrow}>Developer Documentation</p>
        <h1 className={styles.title}>API Reference</h1>
        <p className={styles.description}>
            Relaticle exposes JSON endpoints for companies, people, opportunities,
            tasks, notes, and the current user under <code>/api/v1</code>.
        </p>
        <div className={styles.grid}>
            {["companies", "people", "opportunities", "tasks", "notes", "user"].map((resource) => (
                <div className={styles.card} key={resource}>
                    <h2>{resource[0]?.toUpperCase()}{resource.slice(1)}</h2>
                    <p><code>/api/v1/{resource}</code></p>
                </div>
            ))}
        </div>
    </DocumentationShell>
);

const DeveloperArticlePage = async ({ params }: Properties) => {
    const { type } = await params;
    if (type === "api") return <ApiReference />;
    const page = findDocumentationPage(`docs/guides/${type}`);
    if (!page) notFound();
    return (
        <DocumentationShell>
            <DocumentationArticle backHref="/developers" backLabel="Developer Documentation" page={page} />
        </DocumentationShell>
    );
};

export default DeveloperArticlePage;
