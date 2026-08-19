import type { MetadataRoute } from "next";
import { publicRoutes } from "@/server/marketing/content";
import { getEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

const sitemap = (): MetadataRoute.Sitemap => {
    const origin = (process.env.APP_URL ?? "https://relaticle.com").replace(/\/$/u, "");
    const environment = getEnvironment();
    const featureRoutes = [...(environment.RELATICLE_FEATURE_DOCUMENTATION ? ["/developers", "/help"] : []), ...(environment.RELATICLE_FEATURE_BLOG ? ["/blog"] : [])];
    return [...publicRoutes, ...featureRoutes].map((path) => ({ url: `${origin}${path}`, lastModified: new Date("2026-08-19"), changeFrequency: path === "/" ? "weekly" : "monthly", priority: path === "/" ? 1 : 0.7 }));
};
export default sitemap;
