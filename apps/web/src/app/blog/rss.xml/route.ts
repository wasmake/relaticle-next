import { listPublishedPosts } from "@/server/blog/repository";
import { renderRss } from "@/server/blog/rss";
import { getEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";
export const GET = async (request: Request): Promise<Response> => {
    if (!getEnvironment().RELATICLE_FEATURE_BLOG) return new Response("Not Found", { status: 404 });
    const origin = process.env.APP_URL ?? new URL(request.url).origin;
    return new Response(renderRss(await listPublishedPosts(), origin.replace(/\/$/u, "")), {
        headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300, stale-while-revalidate=3600" },
    });
};
