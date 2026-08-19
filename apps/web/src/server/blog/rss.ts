import type { BlogPostSummary } from "./types";

export const escapeXml = (value: string): string =>
    value.replace(/[<>&"']/gu, (character) => {
        const entities: Readonly<Record<string, string>> = {
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            '"': "&quot;",
            "'": "&apos;",
        };
        return entities[character] ?? character;
    });

export const renderRss = (
    posts: readonly BlogPostSummary[],
    baseUrl: string,
): string => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Relaticle blog</title>
<link>${escapeXml(`${baseUrl}/blog`)}</link>
<description>Product thinking, relationship workflows, and company news.</description>
${posts
    .map(
        (post) => `<item>
<title>${escapeXml(post.title)}</title>
<link>${escapeXml(`${baseUrl}/blog/${post.slug}`)}</link>
<guid isPermaLink="true">${escapeXml(`${baseUrl}/blog/${post.slug}`)}</guid>
${post.publishedAt === null ? "" : `<pubDate>${post.publishedAt.toUTCString()}</pubDate>`}
<description>${escapeXml(post.excerpt ?? "")}</description>
</item>`,
    )
    .join("\n")}
</channel></rss>`;
