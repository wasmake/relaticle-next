import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DocumentationShell, PageGrid, styles } from "../../_components/documentation";
import { findDocumentationCategory, documentationCategories, pagesInCategory } from "@/server/documentation/content";
import { Markdown } from "@/server/documentation/markdown";

type Properties = { params: Promise<{ category: string }> };

export const generateStaticParams = () => documentationCategories
    .filter((category) => category.area === "help")
    .map((category) => ({ category: category.slug }));

export const generateMetadata = async ({ params }: Properties): Promise<Metadata> => {
    const { category } = await params;
    const item = findDocumentationCategory(`help/${category}`);
    return item ? { title: `${item.title} - Relaticle Help`, description: item.description } : {};
};

const HelpCategoryPage = async ({ params }: Properties) => {
    const { category } = await params;
    const item = findDocumentationCategory(`help/${category}`);
    if (!item) notFound();
    return (
        <DocumentationShell>
            <Link className={styles.back} href="/help"><span aria-hidden="true">&larr;</span> Help Centre</Link>
            <p className={styles.eyebrow}>Help Centre</p>
            <h1 className={styles.title}>{item.title}</h1>
            <p className={styles.description}>{item.description}</p>
            {item.body ? <div className={styles.body}><Markdown source={item.body} /></div> : null}
            <PageGrid pages={pagesInCategory("help", category)} />
        </DocumentationShell>
    );
};

export default HelpCategoryPage;
