import { handleNoteRequest } from "@/server/notes/handler";
import { notesApiDependencies } from "@/server/notes/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{
    params: Promise<Readonly<{ noteId: string }>>;
}>;

const handle = async (
    request: Request,
    routeContext: RouteContext,
): Promise<Response> => {
    const { noteId } = await routeContext.params;

    return handleNoteRequest(request, noteId, notesApiDependencies);
};

export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
