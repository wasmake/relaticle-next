import { productionApiAccessResolver } from "@/server/api/production";
import { handleUserRequest } from "@/server/api/user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request): Promise<Response> =>
    handleUserRequest(request, productionApiAccessResolver);
