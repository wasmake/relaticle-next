import { handleImportCollectionRequest } from "@/server/csv/handler";
import { csvApiDependencies } from "@/server/csv/production";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const handle = (request: Request) => handleImportCollectionRequest(request, "notes", csvApiDependencies);
export const GET = handle;
export const POST = handle;
