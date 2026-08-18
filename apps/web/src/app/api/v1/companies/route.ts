import {
    handleCompaniesCollectionRequest,
} from "@/server/companies/handler";
import { companiesApiDependencies } from "@/server/companies/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request): Promise<Response> =>
    handleCompaniesCollectionRequest(request, companiesApiDependencies);

export const POST = GET;
