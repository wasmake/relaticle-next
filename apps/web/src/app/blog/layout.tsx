import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";

import styles from "@/components/blog/blog.module.css";
import { getEnvironment } from "@/server/env";

const BlogLayout = ({ children }: Readonly<{ children: ReactNode }>) => {
    if (!getEnvironment().RELATICLE_FEATURE_BLOG) notFound();
    return (
    <div className={styles.page}>
        <nav className={styles.nav} aria-label="Blog navigation">
            <Link className={styles.wordmark} href="/">Relaticle</Link>
            <div className={styles.navLinks}>
                <Link href="/blog">Journal</Link>
                <Link href="/blog/rss.xml">RSS</Link>
                <Link href="/app/login">Sign in</Link>
            </div>
        </nav>
        {children}
    </div>
    );
};

export default BlogLayout;
