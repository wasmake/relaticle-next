import type { AdminResource } from "./resources";
import { currentSystemAdministrator, type SystemAdministratorSession } from "./session";

export type SystemAdministratorAction = "read" | "write" | "delete";

export const canSystemAdministrator = (
    administrator: Pick<SystemAdministratorSession, "role">,
    action: SystemAdministratorAction,
    resource?: Pick<AdminResource, "slug">,
): boolean => {
    if (administrator.role === "owner") return true;
    if (administrator.role === "admin") return resource?.slug !== "system-administrators";
    return administrator.role === "viewer" && action === "read";
};

export const canDeleteSystemAdministratorRecord = (
    administrator: Pick<SystemAdministratorSession, "id">,
    resource: Pick<AdminResource, "slug">,
    recordId: string,
): boolean => resource.slug !== "system-administrators" || administrator.id !== recordId;

export const requireSystemAdministratorApi = async (): Promise<Response | undefined> =>
    (await currentSystemAdministrator()) === undefined
        ? Response.json({ message: "Unauthenticated." }, { status: 401 })
        : undefined;

export const authorizeSystemAdministratorApi = async (
    action: SystemAdministratorAction,
    resource?: Pick<AdminResource, "slug">,
): Promise<{ administrator: SystemAdministratorSession } | { response: Response }> => {
    const administrator = await currentSystemAdministrator();
    if (administrator === undefined) return { response: Response.json({ message: "Unauthenticated." }, { status: 401 }) };
    if (!canSystemAdministrator(administrator, action, resource)) return { response: Response.json({ message: "Forbidden." }, { status: 403 }) };
    return { administrator };
};

export const rejectCrossOriginWrite = (request: Request): Response | undefined => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return undefined;
    const origin = request.headers.get("origin");
    if (origin !== null && origin === new URL(request.url).origin) return undefined;
    return Response.json({ message: "CSRF token mismatch." }, { status: 419 });
};
