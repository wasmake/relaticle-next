import { handleOpportunityRequest } from "@/server/opportunities/handler";
import { opportunitiesApiDependencies } from "@/server/opportunities/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{
    params: Promise<Readonly<{ opportunityId: string }>>;
}>;

const handle = async (
    request: Request,
    routeContext: RouteContext,
): Promise<Response> => {
    const { opportunityId } = await routeContext.params;

    return handleOpportunityRequest(
        request,
        opportunityId,
        opportunitiesApiDependencies,
    );
};

export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
