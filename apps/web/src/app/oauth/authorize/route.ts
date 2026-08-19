import { handleAuthorization } from "@/server/oauth/http";
import { authorizeBrowserOAuthRequest, productionOAuthService } from "@/server/oauth/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request): Promise<Response> =>
    handleAuthorization(request, productionOAuthService, authorizeBrowserOAuthRequest);

export const POST = GET;
