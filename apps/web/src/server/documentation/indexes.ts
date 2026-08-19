import {
    documentationCategories,
    documentationPages,
    documentationUrl,
    pagesInCategory,
} from "./content";
import { markdownSections } from "./markdown";

export const buildSearchIndex = () => ({
    v: 2,
    records: documentationPages.flatMap((page) => {
        const category = documentationCategories.find(
            (item) => item.path === `${page.area}/${page.category}`,
        );
        const crumb = page.area === "docs" ? "Developer Documentation" : category?.title ?? "Help Centre";
        return markdownSections(page.body).map((section) => ({
            path: page.path,
            title: page.title,
            section: section.section || page.title,
            anchor: section.anchor,
            content: section.content,
            url: `${documentationUrl(page)}${section.anchor ? `#${section.anchor}` : ""}`,
            crumb,
        }));
    }),
});

export const buildLlmsText = (origin: string) => {
    const lines = [
        "# Relaticle",
        "",
        "> Open-source, self-hosted CRM with a built-in AI chat and an MCP server for external AI agents.",
        "",
        "## Help Centre",
        "",
    ];
    for (const category of documentationCategories.filter((item) => item.area === "help")) {
        for (const page of pagesInCategory("help", category.slug)) {
            lines.push(`- [${page.title}](${origin}${documentationUrl(page)}): ${page.description}`);
        }
    }
    lines.push("", "## Developer Documentation", "");
    for (const page of pagesInCategory("docs", "guides")) {
        lines.push(`- [${page.title}](${origin}${documentationUrl(page)}): ${page.description}`);
    }
    lines.push(`- [API Reference](${origin}/developers/api): REST API documentation for managing CRM entities.`);
    return `${lines.join("\n")}\n`;
};
