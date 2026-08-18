import { handlePeopleCollectionRequest } from "@/server/people/handler";
import { peopleApiDependencies } from "@/server/people/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request): Promise<Response> =>
    handlePeopleCollectionRequest(request, peopleApiDependencies);

export const POST = GET;
