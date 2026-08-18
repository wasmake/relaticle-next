import { handleOpportunitiesCollectionRequest } from "@/server/opportunities/handler";
import { opportunitiesApiDependencies } from "@/server/opportunities/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request): Promise<Response> =>
    handleOpportunitiesCollectionRequest(request, opportunitiesApiDependencies);

export const POST = GET;
