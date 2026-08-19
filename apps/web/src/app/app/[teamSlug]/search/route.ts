import { requireBrowserTeam } from "@/server/auth/browser/context";
import { searchWorkspace } from "@/server/search/service";

export const GET = async (request: Request, { params }: { params: Promise<{ teamSlug: string }> }): Promise<Response> => {
    const { teamSlug } = await params;
    const authentication = await requireBrowserTeam(teamSlug);
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ data: await searchWorkspace(authentication.context.teamId, query) });
};
