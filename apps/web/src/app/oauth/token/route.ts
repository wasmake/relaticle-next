import { handleTokenExchange } from "@/server/oauth/http";
import { productionOAuthService } from "@/server/oauth/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = (request: Request): Promise<Response> =>
    handleTokenExchange(request, productionOAuthService);
