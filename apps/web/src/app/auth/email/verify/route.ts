import { NextResponse } from "next/server";

import { verifyEmailToken } from "@/server/accounts/verification";

export const GET = async (request: Request): Promise<Response> => {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const valid = await verifyEmailToken(token);
    return NextResponse.redirect(new URL(valid ? "/app/login?verified=1" : "/app/verify-email?error=invalid", request.url), 303);
};
