import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocumentationArticle, DocumentationShell } from "../../../_components/documentation";
import {
    documentationPages,
    findDocumentationCategory,
    findDocumentationPage,
} from "@/server/documentation/content";

type Properties = { params: Promise<{ category: string; slug: string }> };

export const generateStaticParams = () => documentationPages
    .filter((page) => page.area === "help")
    .map((page) => ({ category: page.category, slug: page.slug }));

export const generateMetadata = async ({ params }: Properties): Promise<Metadata> => {
    const { category, slug } = await params;
    const page = findDocumentationPage(`help/${category}/${slug}`);
    return page ? { title: `${page.title} - Relaticle Help`, description: page.description } : {};
};

const HelpArticlePage = async ({ params }: Properties) => {
    const { category, slug } = await params;
    const page = findDocumentationPage(`help/${category}/${slug}`);
    if (!page) notFound();
    const categoryItem = findDocumentationCategory(`help/${category}`);
    const related = page.related
        .map((path) => findDocumentationPage(path))
        .filter((item) => item !== undefined);
    return (
        <DocumentationShell>
            <DocumentationArticle
                backHref={`/help/${category}`}
                backLabel={categoryItem?.title ?? "Help Centre"}
                page={page}
                related={related}
            />
        </DocumentationShell>
    );
};

export default HelpArticlePage;
