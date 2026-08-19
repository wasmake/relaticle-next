import type { Metadata } from "next";

import styles from "@/components/blog/blog.module.css";
import { PostList } from "@/components/blog/post-list";
import { listPostsByCategory } from "@/server/blog/repository";

type Properties = Readonly<{ params: Promise<{ slug: string }> }>;
export const dynamic = "force-dynamic";
export const generateMetadata = async ({ params }: Properties): Promise<Metadata> => {
    const { slug } = await params;
    return { title: `${slug} articles | Relaticle`, robots: { index: true, follow: true } };
};
const CategoryPage = async ({ params }: Properties) => {
    const { slug } = await params;
    return <main className={styles.main}><header className={styles.hero}><p className={styles.eyebrow}>Category</p><h1>{slug.replaceAll("-", " ")}</h1></header><PostList posts={await listPostsByCategory(slug)} /></main>;
};
export default CategoryPage;
