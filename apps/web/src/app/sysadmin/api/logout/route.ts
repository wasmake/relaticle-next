import { clearSystemAdministratorCookie } from "@/server/sysadmin/session";
import { rejectCrossOriginWrite } from "@/server/sysadmin/http";

export const POST = async (request: Request): Promise<Response> => {
    const csrf = rejectCrossOriginWrite(request); if (csrf !== undefined) return csrf;
    await clearSystemAdministratorCookie();
    return Response.redirect(new URL("/sysadmin/login", request.url), 303);
};
