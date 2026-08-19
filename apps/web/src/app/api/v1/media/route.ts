import { handleMediaCollectionRequest } from "@/server/media/handler";
import { mediaApiDependencies } from "@/server/media/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = (request: Request): Promise<Response> => handleMediaCollectionRequest(request, mediaApiDependencies);
