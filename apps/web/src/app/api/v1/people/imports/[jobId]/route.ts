import { handleImportRequest } from "@/server/csv/handler";
import { csvApiDependencies } from "@/server/csv/production";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = async (request: Request, context: { params: Promise<{ jobId: string }> }) => handleImportRequest(request, "people", (await context.params).jobId, csvApiDependencies);
