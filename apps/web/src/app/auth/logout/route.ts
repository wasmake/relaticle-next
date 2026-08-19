import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { requireBrowserUser } from "@/server/auth/browser/context";
import { rejectCrossOrigin } from "@/server/auth/browser/request";
import { createHttpAuthConfiguration } from "@/server/auth/http";
import { getDatabase } from "@/server/db/client";
import { sessions } from "@/server/db/schema";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const identity = await requireBrowserUser();
    if (identity.credential.kind === "session") await getDatabase().delete(sessions).where(eq(sessions.id, identity.credential.sessionId));
    const response = NextResponse.redirect(new URL("/app/login", request.url), 303);
    response.cookies.set(createHttpAuthConfiguration().sessionCookieName, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    return response;
};
