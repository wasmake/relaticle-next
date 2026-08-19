import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import styles from "@/components/blog/blog.module.css";
import { Markdown } from "@/components/blog/markdown";
import { findPost } from "@/server/blog/repository";

type Properties = Readonly<{ params: Promise<{ slug: string }> }>;

export const generateMetadata = async ({ params }: Properties): Promise<Metadata> => {
    const { slug } = await params;
    const post = await findPost(slug);
    if (post === undefined) return {};
    const description = post.seoDescription ?? post.excerpt ?? undefined;
    const image = post.seoImage ?? post.featuredImage ?? undefined;
    return {
        title: post.seoTitle ?? `${post.title} | Relaticle`,
        description,
        alternates: { canonical: post.canonicalUrl ?? `/blog/${post.slug}` },
        robots: post.robots ?? undefined,
        openGraph: { type: "article", title: post.seoTitle ?? post.title, description, images: image === undefined ? [] : [image], publishedTime: post.publishedAt?.toISOString() },
    };
};

const BlogPostPage = async ({ params }: Properties) => {
    const { slug } = await params;
    const post = await findPost(slug);
    if (post === undefined) notFound();
    return <main className={styles.main}><article className={styles.article}>
        <header className={styles.articleHeader}>
            <p className={styles.eyebrow}>{post.category?.name ?? "Journal"}</p>
            <h1>{post.title}</h1>
            <div className={styles.meta}>
                {post.authorName === null ? null : <span>By {post.authorName}</span>}
                {post.publishedAt === null ? null : <time dateTime={post.publishedAt.toISOString()}>{post.publishedAt.toLocaleDateString("en", { dateStyle: "long", timeZone: "UTC" })}</time>}
            </div>
        </header>
        {/* Images are administrator-provided URLs and cannot use a fixed Next image allowlist. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {post.featuredImage === null ? null : <img className={styles.featured} src={post.featuredImage} alt="" />}
        <div className={styles.content}><Markdown>{post.content}</Markdown></div>
        <footer className={styles.meta}>
            {post.tags.map((tag) => <Link href={`/blog/tag/${tag.slug}`} key={tag.slug}>#{tag.name}</Link>)}
        </footer>
    </article></main>;
};

export default BlogPostPage;
