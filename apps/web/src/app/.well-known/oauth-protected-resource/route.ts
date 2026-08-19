import { oauthJson, protectedResourceMetadata } from "@/server/oauth/http";

export const dynamic = "force-dynamic";

export const GET = (request: Request): Response =>
    oauthJson(protectedResourceMetadata(new URL(request.url).origin));
