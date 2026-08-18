import { handlePersonRequest } from "@/server/people/handler";
import { peopleApiDependencies } from "@/server/people/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{
    params: Promise<Readonly<{ personId: string }>>;
}>;

const handle = async (
    request: Request,
    routeContext: RouteContext,
): Promise<Response> => {
    const { personId } = await routeContext.params;

    return handlePersonRequest(request, personId, peopleApiDependencies);
};

export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
