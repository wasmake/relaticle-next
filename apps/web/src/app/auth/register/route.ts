import { NextResponse } from "next/server";
import { z } from "zod";

import { accountMailDelivery } from "@/server/accounts/delivery";
import { AccountValidationError, registerAccount } from "@/server/accounts/service";
import { createEmailVerificationToken } from "@/server/accounts/verification";
import { formValue, rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { createBrowserSession } from "@/server/auth/browser/session";
import { getEnvironment } from "@/server/env";
import { verifyTurnstile } from "@/server/auth/turnstile";
import { queueMailcoachEvent } from "@/server/accounts/mailcoach";

const schema = z.object({ name: z.string().trim().min(2).max(255), email: z.email().max(255), password: z.string().min(12).max(1024) });

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const form = await request.formData();
    const input = schema.safeParse({ name: textFormValue(form, "name"), email: textFormValue(form, "email"), password: formValue(form, "password") });
    if (!input.success || input.data.password !== formValue(form, "password_confirmation")) return NextResponse.redirect(new URL("/app/register?error=invalid", request.url), 303);
    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    if (!(await verifyTurnstile(textFormValue(form, "cf-turnstile-response"), ipAddress))) return NextResponse.redirect(new URL("/app/register?error=turnstile", request.url), 303);

    try {
        const user = await registerAccount(input.data);
        await queueMailcoachEvent(user.id, "registration");
        const token = createEmailVerificationToken(user.id, user.email);
        if (token !== undefined) await accountMailDelivery.send({ kind: "email-verification", recipient: user.email, url: new URL(`/auth/email/verify?token=${encodeURIComponent(token)}`, request.url).toString() });
        if (getEnvironment().REQUIRE_EMAIL_VERIFICATION) return NextResponse.redirect(new URL("/app/verify-email?sent=1", request.url), 303);

        const session = await createBrowserSession({ email: input.data.email, password: input.data.password, ipAddress, userAgent: request.headers.get("user-agent") });
        if (!session.ok) return NextResponse.redirect(new URL("/app/login", request.url), 303);
        const response = NextResponse.redirect(new URL("/app/new", request.url), 303);
        response.cookies.set(session.cookieName, session.cookieValue, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: session.lifetimeSeconds });
        return response;
    } catch (error) {
        const code = error instanceof AccountValidationError ? "exists" : "failed";
        return NextResponse.redirect(new URL(`/app/register?error=${code}`, request.url), 303);
    }
};
