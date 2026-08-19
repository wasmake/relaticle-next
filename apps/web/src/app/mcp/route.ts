import { productionMcpDependencies } from "@/server/mcp/production";
import { handleMcpRequest } from "@/server/mcp/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = (request: Request): Promise<Response> =>
    handleMcpRequest(request, productionMcpDependencies);

export const OPTIONS = POST;
