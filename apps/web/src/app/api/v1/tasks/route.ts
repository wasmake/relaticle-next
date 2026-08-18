import { handleTasksCollectionRequest } from "@/server/tasks/handler";
import { tasksApiDependencies } from "@/server/tasks/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: Request): Promise<Response> =>
    handleTasksCollectionRequest(request, tasksApiDependencies);

export const POST = GET;
