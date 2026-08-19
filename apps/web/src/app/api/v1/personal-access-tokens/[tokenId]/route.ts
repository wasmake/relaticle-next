import { handlePersonalAccessTokenRequest } from "@/server/personal-access-tokens/handler";
import { personalAccessTokensApiDependencies } from "@/server/personal-access-tokens/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{ params: Promise<{ tokenId: string }> }>;

export const DELETE = async (
    request: Request,
    routeContext: RouteContext,
): Promise<Response> => {
    const { tokenId } = await routeContext.params;
    return handlePersonalAccessTokenRequest(
        request,
        tokenId,
        personalAccessTokensApiDependencies,
    );
};
