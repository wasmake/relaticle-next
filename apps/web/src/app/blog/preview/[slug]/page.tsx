import { notFound } from "next/navigation";

import styles from "@/components/blog/blog.module.css";
import { Markdown } from "@/components/blog/markdown";
import { findPost } from "@/server/blog/repository";
import { verifyPreviewToken } from "@/server/blog/preview";

export const metadata = { title: "Post preview", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
type Properties = Readonly<{ params: Promise<{ slug: string }>; searchParams: Promise<{ token?: string }> }>;
const PreviewPage = async ({ params, searchParams }: Properties) => {
    const [{ slug }, query] = await Promise.all([params, searchParams]);
    if (query.token === undefined || !verifyPreviewToken(query.token, slug)) notFound();
    const post = await findPost(slug, true);
    if (post === undefined) notFound();
    return <><div className={styles.preview}>Private preview: {post.status}</div><main className={styles.main}><article className={styles.article}><header className={styles.articleHeader}><p className={styles.eyebrow}>Preview</p><h1>{post.title}</h1></header><div className={styles.content}><Markdown>{post.content}</Markdown></div></article></main></>;
};
export default PreviewPage;
