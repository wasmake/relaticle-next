import { handleCustomFieldMetadataRequest } from "@/server/custom-field-metadata/handler";
import { customFieldMetadataApiDependencies } from "@/server/custom-field-metadata/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request): Promise<Response> =>
    handleCustomFieldMetadataRequest(request, customFieldMetadataApiDependencies);
