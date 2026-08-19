import { NextResponse } from "next/server";

import { beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor } from "@/server/accounts/two-factor";
import { requireBrowserUser } from "@/server/auth/browser/context";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected) return rejected;
    const identity = await requireBrowserUser();
    const form = await request.formData();
    const intent = textFormValue(form, "intent");
    if (intent === "setup") {
        await beginTwoFactorSetup(identity.userId);
        return NextResponse.redirect(new URL("/app/settings/security?two_factor=setup", request.url), 303);
    }
    if (intent === "confirm") {
        const codes = await confirmTwoFactorSetup(identity.userId, textFormValue(form, "code"));
        if (codes === undefined) return NextResponse.redirect(new URL("/app/settings/security?error=two_factor", request.url), 303);
        const response = NextResponse.redirect(new URL("/app/settings/security?two_factor=enabled", request.url), 303);
        response.cookies.set("relaticle_recovery_codes", Buffer.from(JSON.stringify(codes)).toString("base64url"), { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/app/settings/security", maxAge: 300 });
        return response;
    }
    if (intent === "disable" && await disableTwoFactor(identity.userId, textFormValue(form, "code"))) return NextResponse.redirect(new URL("/app/settings/security?two_factor=disabled", request.url), 303);
    return NextResponse.redirect(new URL("/app/settings/security?error=two_factor", request.url), 303);
};
