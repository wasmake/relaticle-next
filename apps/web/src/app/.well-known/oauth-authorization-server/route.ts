import { authorizationServerMetadata, oauthJson } from "@/server/oauth/http";

export const dynamic = "force-dynamic";

export const GET = (request: Request): Response =>
    oauthJson(authorizationServerMetadata(new URL(request.url).origin));
