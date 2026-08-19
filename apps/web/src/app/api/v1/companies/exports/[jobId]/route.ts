import { handleExportRequest } from "@/server/csv/handler";
import { csvApiDependencies } from "@/server/csv/production";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = async (request: Request, context: { params: Promise<{ jobId: string }> }) => handleExportRequest(request, "companies", (await context.params).jobId, csvApiDependencies);
