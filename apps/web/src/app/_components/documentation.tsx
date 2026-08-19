import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import styles from "../documentation.module.css";
import type { DocumentationPage } from "@/server/documentation/content";
import { documentationUrl } from "@/server/documentation/content";
import { Markdown, markdownSections } from "@/server/documentation/markdown";
import { getEnvironment } from "@/server/env";

export const DocumentationShell = ({ children }: { children: ReactNode }) => {
    if (!getEnvironment().RELATICLE_FEATURE_DOCUMENTATION) notFound();
    return (
    <div className={styles.page}>
        <header className={styles.header}>
            <Link className={styles.brand} href="/">Relaticle</Link>
            <nav aria-label="Documentation" className={styles.nav}>
                <Link href="/help">Help</Link>
                <Link href="/developers">Developers</Link>
                <Link href="/app/login">Sign in</Link>
            </nav>
        </header>
        <main className={styles.main}>{children}</main>
    </div>
    );
};

export const PageGrid = ({ pages }: { pages: readonly DocumentationPage[] }) => (
    <div className={styles.grid}>
        {pages.map((page) => (
            <Link className={styles.card} href={documentationUrl(page)} key={page.path}>
                <h3>{page.title}</h3>
                <p>{page.description}</p>
                <span>Read article</span>
            </Link>
        ))}
    </div>
);

export const DocumentationArticle = ({
    backHref,
    backLabel,
    page,
    related = [],
}: {
    backHref: string;
    backLabel: string;
    page: DocumentationPage;
    related?: readonly DocumentationPage[];
}) => {
    const headings = markdownSections(page.body).filter((section) => section.anchor);
    return (
        <>
            <Link className={styles.back} href={backHref}><span aria-hidden="true">&larr;</span> {backLabel}</Link>
            <div className={styles.articleLayout}>
                <article className={styles.article}>
                    <header className={styles.articleHeader}>
                        <p className={styles.eyebrow}>{backLabel}</p>
                        <h1>{page.title}</h1>
                        <p className={styles.description}>{page.description}</p>
                        {page.updated ? <p className={styles.updated}>Updated {page.updated}</p> : null}
                    </header>
                    <div className={styles.body}><Markdown source={page.body} /></div>
                    {related.length > 0 ? (
                        <aside className={styles.related}>
                            <h2>Related articles</h2>
                            {related.map((item) => <Link href={documentationUrl(item)} key={item.path}>{item.title}</Link>)}
                        </aside>
                    ) : null}
                </article>
                {headings.length > 0 ? (
                    <nav aria-label="On this page" className={styles.toc}>
                        <strong>On this page</strong>
                        {headings.map((heading) => <a href={`#${heading.anchor}`} key={heading.anchor}>{heading.section}</a>)}
                    </nav>
                ) : null}
            </div>
        </>
    );
};

export { styles };
