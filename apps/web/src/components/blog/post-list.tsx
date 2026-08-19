import Link from "next/link";

import type { BlogPostSummary } from "@/server/blog/types";

import styles from "./blog.module.css";

const date = (value: Date | null): string =>
    value === null
        ? "Unscheduled"
        : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(value);

export const PostList = ({ posts }: Readonly<{ posts: readonly BlogPostSummary[] }>) =>
    posts.length === 0 ? (
        <p className={styles.empty}>No published posts found.</p>
    ) : (
        <section className={styles.grid} aria-label="Blog posts">
            {posts.map((post) => (
                <Link className={styles.card} href={`/blog/${post.slug}`} key={post.id}>
                    <div className={styles.meta}>
                        <time dateTime={post.publishedAt?.toISOString()}>{date(post.publishedAt)}</time>
                        {post.category === null ? null : <span>{post.category.name}</span>}
                    </div>
                    <h2>{post.title}</h2>
                    <p>{post.excerpt}</p>
                </Link>
            ))}
        </section>
    );
