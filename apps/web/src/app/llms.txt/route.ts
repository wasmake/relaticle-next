import { buildLlmsText } from "@/server/documentation/indexes";
import { getEnvironment } from "@/server/env";

export const GET = (request: Request) => getEnvironment().RELATICLE_FEATURE_DOCUMENTATION
    ? new Response(buildLlmsText(new URL(request.url).origin), { headers: { "content-type": "text/plain; charset=utf-8" } })
    : new Response("Not Found", { status: 404 });
