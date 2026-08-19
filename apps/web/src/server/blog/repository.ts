import { getSqlClient } from "@/server/db/client";

import type { BlogPost, BlogPostSummary, BlogTaxonomy } from "./types";

type Row = Record<string, unknown>;

const taxonomy = (value: unknown): readonly BlogTaxonomy[] =>
    Array.isArray(value)
        ? value.filter(
              (item): item is BlogTaxonomy =>
                  typeof item === "object" &&
                  item !== null &&
                  typeof (item as BlogTaxonomy).name === "string" &&
                  typeof (item as BlogTaxonomy).slug === "string",
          )
        : [];

const summaryFromRow = (row: Row): BlogPostSummary => ({
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    excerpt: typeof row.excerpt === "string" ? row.excerpt : null,
    featuredImage:
        typeof row.featured_image === "string" ? row.featured_image : null,
    publishedAt:
        row.published_at instanceof Date ? row.published_at : null,
    authorName: typeof row.author_name === "string" ? row.author_name : null,
    category:
        typeof row.category_name === "string" &&
        typeof row.category_slug === "string"
            ? { name: row.category_name, slug: row.category_slug }
            : null,
    tags: taxonomy(row.tags),
});

const selectPosts = async (
    filter: Readonly<{ category?: string; tag?: string }> = {},
): Promise<readonly BlogPostSummary[]> => {
    const sql = getSqlClient();
    const category = filter.category ?? null;
    const tag = filter.tag ?? null;
    const rows = await sql<Row[]>`
        select p.id, p.title, p.slug, p.excerpt, p.featured_image,
            p.published_at, u.name as author_name,
            c.name as category_name, c.slug as category_slug,
            coalesce(json_agg(distinct jsonb_build_object('name', t.name, 'slug', t.slug))
                filter (where t.id is not null), '[]') as tags
        from blog_posts p
        left join users u on u.id = p.author_id
        left join blog_categories c on c.id = p.category_id and c.deleted_at is null
        left join blog_post_tag pt on pt.post_id = p.id
        left join blog_tags t on t.id = pt.tag_id and t.deleted_at is null
        where p.status = 'published' and p.deleted_at is null
            and p.published_at is not null and p.published_at <= now()
            and (${category}::text is null or c.slug = ${category})
            and (${tag}::text is null or exists (
                select 1 from blog_post_tag x
                join blog_tags xt on xt.id = x.tag_id
                where x.post_id = p.id and xt.slug = ${tag} and xt.deleted_at is null
            ))
        group by p.id, u.name, c.name, c.slug
        order by p.published_at desc
    `;

    return rows.map(summaryFromRow);
};

export const listPublishedPosts = (): Promise<readonly BlogPostSummary[]> =>
    selectPosts();

export const listPostsByCategory = (
    slug: string,
): Promise<readonly BlogPostSummary[]> => selectPosts({ category: slug });

export const listPostsByTag = (
    slug: string,
): Promise<readonly BlogPostSummary[]> => selectPosts({ tag: slug });

export const findPost = async (
    slug: string,
    includeUnpublished = false,
): Promise<BlogPost | undefined> => {
    const sql = getSqlClient();
    const rows = await sql<Row[]>`
        select p.id, p.title, p.slug, p.content, p.excerpt, p.featured_image,
            p.status, p.published_at, u.name as author_name,
            c.name as category_name, c.slug as category_slug,
            s.title as seo_title, s.description as seo_description,
            s.image as seo_image, s.canonical_url, s.robots,
            coalesce(json_agg(distinct jsonb_build_object('name', t.name, 'slug', t.slug))
                filter (where t.id is not null), '[]') as tags
        from blog_posts p
        left join users u on u.id = p.author_id
        left join blog_categories c on c.id = p.category_id and c.deleted_at is null
        left join blog_post_tag pt on pt.post_id = p.id
        left join blog_tags t on t.id = pt.tag_id and t.deleted_at is null
        left join seo s on s.model_id = p.id and s.model_type like '%BlogPost'
        where p.slug = ${slug} and p.deleted_at is null
            and (${includeUnpublished} or (
                p.status = 'published' and p.published_at is not null
                and p.published_at <= now()
            ))
        group by p.id, u.name, c.name, c.slug, s.title, s.description,
            s.image, s.canonical_url, s.robots
        limit 1
    `;
    const row = rows[0];
    if (row === undefined) return undefined;

    return {
        ...summaryFromRow(row),
        content: String(row.content),
        status: String(row.status),
        seoTitle: typeof row.seo_title === "string" ? row.seo_title : null,
        seoDescription:
            typeof row.seo_description === "string" ? row.seo_description : null,
        seoImage: typeof row.seo_image === "string" ? row.seo_image : null,
        canonicalUrl:
            typeof row.canonical_url === "string" ? row.canonical_url : null,
        robots: typeof row.robots === "string" ? row.robots : null,
    };
};
