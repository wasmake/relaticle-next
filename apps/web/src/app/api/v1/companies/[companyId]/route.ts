import { handleCompanyRequest } from "@/server/companies/handler";
import { companiesApiDependencies } from "@/server/companies/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{
    params: Promise<Readonly<{ companyId: string }>>;
}>;

const handle = async (
    request: Request,
    routeContext: RouteContext,
): Promise<Response> => {
    const { companyId } = await routeContext.params;

    return handleCompanyRequest(request, companyId, companiesApiDependencies);
};

export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
