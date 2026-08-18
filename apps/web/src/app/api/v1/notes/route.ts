import { handleNotesCollectionRequest } from "@/server/notes/handler";
import { notesApiDependencies } from "@/server/notes/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request): Promise<Response> =>
    handleNotesCollectionRequest(request, notesApiDependencies);

export const POST = GET;
