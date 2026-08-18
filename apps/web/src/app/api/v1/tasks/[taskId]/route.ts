import { handleTaskRequest } from "@/server/tasks/handler";
import { tasksApiDependencies } from "@/server/tasks/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = Readonly<{
    params: Promise<Readonly<{ taskId: string }>>;
}>;

const handle = async (
    request: Request,
    routeContext: RouteContext,
): Promise<Response> => {
    const { taskId } = await routeContext.params;

    return handleTaskRequest(request, taskId, tasksApiDependencies);
};

export const GET = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
