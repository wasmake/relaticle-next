import { handleMediaRequest } from "@/server/media/handler";
import { mediaApiDependencies } from "@/server/media/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = Readonly<{ params: Promise<{ uuid: string }> }>;
export const GET = async (request: Request, context: Context): Promise<Response> => handleMediaRequest(request, (await context.params).uuid, mediaApiDependencies);
export const DELETE = GET;
