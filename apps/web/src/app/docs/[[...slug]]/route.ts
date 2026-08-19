import { legacyDocumentationTarget } from "@/server/marketing/redirects";
import { getEnvironment } from "@/server/env";

export const GET = async (request: Request, { params }: Readonly<{ params: Promise<{ slug?: string[] }> }>) => getEnvironment().RELATICLE_FEATURE_DOCUMENTATION ? Response.redirect(new URL(legacyDocumentationTarget((await params).slug), request.url), 301) : new Response("Not Found", { status: 404 });
