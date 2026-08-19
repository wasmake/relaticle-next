import type { Metadata } from "next";

import styles from "@/components/blog/blog.module.css";
import { PostList } from "@/components/blog/post-list";
import { listPostsByTag } from "@/server/blog/repository";

type Properties = Readonly<{ params: Promise<{ slug: string }> }>;
export const dynamic = "force-dynamic";
export const generateMetadata = async ({ params }: Properties): Promise<Metadata> => {
    const { slug } = await params;
    return { title: `#${slug} articles | Relaticle`, robots: { index: true, follow: true } };
};
const TagPage = async ({ params }: Properties) => {
    const { slug } = await params;
    return <main className={styles.main}><header className={styles.hero}><p className={styles.eyebrow}>Tag</p><h1>#{slug}</h1></header><PostList posts={await listPostsByTag(slug)} /></main>;
};
export default TagPage;
