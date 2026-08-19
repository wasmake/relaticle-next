export type BlogTaxonomy = Readonly<{
    name: string;
    slug: string;
}>;

export type BlogPostSummary = Readonly<{
    id: string;
    title: string;
    slug: string;
    excerpt: string | null;
    featuredImage: string | null;
    publishedAt: Date | null;
    authorName: string | null;
    category: BlogTaxonomy | null;
    tags: readonly BlogTaxonomy[];
}>;

export type BlogPost = BlogPostSummary &
    Readonly<{
        content: string;
        status: string;
        seoTitle: string | null;
        seoDescription: string | null;
        seoImage: string | null;
        canonicalUrl: string | null;
        robots: string | null;
    }>;
