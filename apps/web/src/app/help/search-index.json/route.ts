import { buildSearchIndex } from "@/server/documentation/indexes";
import { getEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

export const GET = () => getEnvironment().RELATICLE_FEATURE_DOCUMENTATION ? Response.json(buildSearchIndex()) : new Response("Not Found", { status: 404 });
