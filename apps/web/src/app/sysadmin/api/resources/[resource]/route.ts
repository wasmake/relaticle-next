import { authorizeSystemAdministratorApi, rejectCrossOriginWrite } from "@/server/sysadmin/http";
import { parseBoundedJsonObject } from "@/server/http/body";
import { createAdminRecord, getAdminResource, listAdminRecords } from "@/server/sysadmin/resources";

type Context = Readonly<{ params: Promise<{ resource: string }> }>;
const resolve = async (context: Context) => getAdminResource((await context.params).resource);
export const GET = async (request: Request, context: Context): Promise<Response> => {
    const resource = await resolve(context); if (resource === undefined) return Response.json({ message: "Not found." }, { status: 404 });
    const authorization = await authorizeSystemAdministratorApi("read", resource); if ("response" in authorization) return authorization.response;
    const url = new URL(request.url); const data = await listAdminRecords(resource, Number(url.searchParams.get("page") ?? "1"), url.searchParams.get("q") ?? "");
    return Response.json({ data: data.records, meta: { total: data.total, page: data.page, per_page: data.perPage } });
};
export const POST = async (request: Request, context: Context): Promise<Response> => {
    const csrf = rejectCrossOriginWrite(request); if (csrf !== undefined) return csrf;
    const resource = await resolve(context); if (resource === undefined) return Response.json({ message: "Not found." }, { status: 404 });
    const authorization = await authorizeSystemAdministratorApi("write", resource); if ("response" in authorization) return authorization.response;
    try { const input = await parseBoundedJsonObject(request); return Response.json({ data: await createAdminRecord(resource, input) }, { status: 201 }); }
    catch (error) { return Response.json({ message: error instanceof Error ? error.message : "Invalid request." }, { status: 422 }); }
};
