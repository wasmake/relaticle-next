import { handlePersonalAccessTokensCollectionRequest } from "@/server/personal-access-tokens/handler";
import { personalAccessTokensApiDependencies } from "@/server/personal-access-tokens/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request): Promise<Response> =>
    handlePersonalAccessTokensCollectionRequest(request, personalAccessTokensApiDependencies);

export const POST = GET;
