import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type DocumentationArea = "docs" | "help";

export type DocumentationPage = Readonly<{
    area: DocumentationArea;
    body: string;
    category: string;
    description: string;
    order: number;
    path: string;
    related: readonly string[];
    slug: string;
    title: string;
    updated?: string;
}>;

export type DocumentationCategory = Readonly<{
    area: DocumentationArea;
    body: string;
    description: string;
    order: number;
    path: string;
    slug: string;
    title: string;
}>;

type FrontMatter = Record<string, string>;

const contentRoot = join(
    process.cwd(),
    "apps",
    "web",
    "content",
    "documentation",
);

const parseFrontMatter = (raw: string, path: string) => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
    if (!match) {
        throw new Error(`Documentation file ${path} has invalid front matter.`);
    }

    const metadata: FrontMatter = {};
    for (const line of (match[1] ?? "").split(/\r?\n/)) {
        const separator = line.indexOf(":");
        if (separator === -1) continue;
        metadata[line.slice(0, separator).trim()] = line
            .slice(separator + 1)
            .trim()
            .replace(/^(["'])(.*)\1$/, "$2");
    }

    const title = metadata.title;
    const description = metadata.description;
    const order = Number(metadata.order);
    if (!title || !description || !Number.isInteger(order)) {
        throw new Error(`Documentation file ${path} is missing required metadata.`);
    }

    return { body: (match[2] ?? "").trim(), description, metadata, order, title };
};

const parseRelated = (value: string | undefined) => {
    if (!value?.startsWith("[") || !value.endsWith("]")) return [];
    return value
        .slice(1, -1)
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const loadContent = () => {
    const pages: DocumentationPage[] = [];
    const categories: DocumentationCategory[] = [];

    for (const area of ["docs", "help"] as const) {
        const areaRoot = join(contentRoot, area);
        for (const category of readdirSync(areaRoot, { withFileTypes: true })) {
            if (!category.isDirectory()) continue;
            const categoryRoot = join(areaRoot, category.name);
            for (const file of readdirSync(categoryRoot, { withFileTypes: true })) {
                if (!file.isFile() || !file.name.endsWith(".md")) continue;
                const slug = file.name.slice(0, -3);
                const path = `${area}/${category.name}/${slug}`;
                const parsed = parseFrontMatter(
                    readFileSync(join(categoryRoot, file.name), "utf8"),
                    path,
                );

                if (slug === "_index") {
                    categories.push({
                        area,
                        body: parsed.body,
                        description: parsed.description,
                        order: parsed.order,
                        path: `${area}/${category.name}`,
                        slug: category.name,
                        title: parsed.title,
                    });
                } else {
                    pages.push({
                        area,
                        body: parsed.body,
                        category: category.name,
                        description: parsed.description,
                        order: parsed.order,
                        path,
                        related: parseRelated(parsed.metadata.related),
                        slug,
                        title: parsed.title,
                        ...(parsed.metadata.updated
                            ? { updated: parsed.metadata.updated }
                            : {}),
                    });
                }
            }
        }
    }

    categories.sort((left, right) => left.order - right.order);
    pages.sort((left, right) => {
        const leftCategory = categories.find((item) => item.path === `${left.area}/${left.category}`);
        const rightCategory = categories.find((item) => item.path === `${right.area}/${right.category}`);
        return (leftCategory?.order ?? 999) - (rightCategory?.order ?? 999)
            || left.order - right.order
            || left.title.localeCompare(right.title);
    });
    return { categories, pages } as const;
};

const content = loadContent();

export const documentationCategories = content.categories;
export const documentationPages = content.pages;

export const pagesInCategory = (area: DocumentationArea, category: string) =>
    documentationPages.filter(
        (page) => page.area === area && page.category === category,
    );

export const documentationUrl = (page: DocumentationPage) =>
    page.area === "docs"
        ? `/developers/${page.slug}`
        : `/help/${page.category}/${page.slug}`;

export const findDocumentationPage = (path: string) =>
    documentationPages.find((page) => page.path === path);

export const findDocumentationCategory = (path: string) =>
    documentationCategories.find((category) => category.path === path);
