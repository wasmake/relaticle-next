import { authorizeSystemAdministratorApi, canDeleteSystemAdministratorRecord, rejectCrossOriginWrite } from "@/server/sysadmin/http";
import { parseBoundedJsonObject } from "@/server/http/body";
import { deleteAdminRecord, findAdminRecord, getAdminResource, updateAdminRecord } from "@/server/sysadmin/resources";

type Context = Readonly<{ params: Promise<{ resource: string; id: string }> }>;
const resolve = async (context: Context) => { const params = await context.params; return { params, resource: getAdminResource(params.resource) }; };
export const GET = async (_request: Request, context: Context): Promise<Response> => {
    const { params, resource } = await resolve(context); if (resource === undefined) return Response.json({ message: "Not found." }, { status: 404 });
    const authorization = await authorizeSystemAdministratorApi("read", resource); if ("response" in authorization) return authorization.response;
    const record = await findAdminRecord(resource, params.id); return record === undefined ? Response.json({ message: "Not found." }, { status: 404 }) : Response.json({ data: record });
};
export const PATCH = async (request: Request, context: Context): Promise<Response> => {
    const csrf = rejectCrossOriginWrite(request); if (csrf !== undefined) return csrf;
    const { params, resource } = await resolve(context); if (resource === undefined) return Response.json({ message: "Not found." }, { status: 404 });
    const authorization = await authorizeSystemAdministratorApi("write", resource); if ("response" in authorization) return authorization.response;
    try { const record = await updateAdminRecord(resource, params.id, await parseBoundedJsonObject(request)); return record === undefined ? Response.json({ message: "Not found." }, { status: 404 }) : Response.json({ data: record }); }
    catch (error) { return Response.json({ message: error instanceof Error ? error.message : "Invalid request." }, { status: 422 }); }
};
export const DELETE = async (request: Request, context: Context): Promise<Response> => {
    const csrf = rejectCrossOriginWrite(request); if (csrf !== undefined) return csrf;
    const { params, resource } = await resolve(context); if (resource === undefined) return Response.json({ message: "Not found." }, { status: 404 });
    const authorization = await authorizeSystemAdministratorApi("delete", resource); if ("response" in authorization) return authorization.response;
    if (!canDeleteSystemAdministratorRecord(authorization.administrator, resource, params.id)) return Response.json({ message: "You cannot delete your own administrator account." }, { status: 409 });
    if (!(await deleteAdminRecord(resource, params.id))) return Response.json({ message: "Not found." }, { status: 404 });
    return new Response(null, { status: 204 });
};
