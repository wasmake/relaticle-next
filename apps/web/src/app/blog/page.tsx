import type { Metadata } from "next";

import styles from "@/components/blog/blog.module.css";
import { PostList } from "@/components/blog/post-list";
import { listPublishedPosts } from "@/server/blog/repository";

export const metadata: Metadata = {
    title: "Journal | Relaticle",
    description: "Product thinking, relationship workflows, and company news from Relaticle.",
    alternates: { types: { "application/rss+xml": "/blog/rss.xml" } },
};
export const dynamic = "force-dynamic";

const BlogPage = async () => {
    const posts = await listPublishedPosts();
    return <main className={styles.main}>
        <header className={styles.hero}>
            <p className={styles.eyebrow}>The Relaticle journal</p>
            <h1>Relationships are the work.</h1>
            <p>Ideas for building durable customer context, calmer systems, and teams that remember.</p>
        </header>
        <PostList posts={posts} />
    </main>;
};

export default BlogPage;
