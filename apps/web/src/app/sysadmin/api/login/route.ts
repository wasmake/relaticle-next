import { authenticateSystemAdministrator, setSystemAdministratorCookie } from "@/server/sysadmin/session";
import { rejectCrossOriginWrite } from "@/server/sysadmin/http";
import { parseBoundedFormData } from "@/server/http/body";
import { authenticationRateLimiter } from "@/server/auth/rate-limiter";

export const runtime = "nodejs";
export const POST = async (request: Request): Promise<Response> => {
    const csrf = rejectCrossOriginWrite(request); if (csrf !== undefined) return csrf;
    const form = await parseBoundedFormData(request);
    const email = form.get("email"); const password = form.get("password");
    if (typeof email !== "string" || typeof password !== "string") return Response.redirect(new URL("/sysadmin/login?error=invalid", request.url), 303);
    if (!(await authenticationRateLimiter.consume("sysadmin", request.headers, email))) return Response.redirect(new URL("/sysadmin/login?error=rate_limited", request.url), 303);
    const administrator = await authenticateSystemAdministrator(email.trim(), password);
    if (administrator === undefined) return Response.redirect(new URL("/sysadmin/login?error=invalid", request.url), 303);
    await setSystemAdministratorCookie(administrator);
    return Response.redirect(new URL("/sysadmin", request.url), 303);
};
