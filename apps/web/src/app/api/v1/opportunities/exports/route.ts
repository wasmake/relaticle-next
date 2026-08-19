import { handleExportCollectionRequest } from "@/server/csv/handler";
import { csvApiDependencies } from "@/server/csv/production";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = (request: Request) => handleExportCollectionRequest(request, "opportunities", csvApiDependencies);
