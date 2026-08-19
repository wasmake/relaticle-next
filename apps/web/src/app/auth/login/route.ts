import { NextResponse } from "next/server";
import { z } from "zod";

import { createBrowserSession } from "@/server/auth/browser/session";
import { rejectCrossOrigin } from "@/server/auth/browser/request";
import { authenticationRateLimiter } from "@/server/auth/rate-limiter";
import { verifyTurnstile } from "@/server/auth/turnstile";
import { queueMailcoachEvent } from "@/server/accounts/mailcoach";

const credentialsSchema = z.object({
    email: z.email().max(255),
    password: z.string().min(1).max(1024),
    next: z.string().max(2048).optional(),
    remember: z.boolean(),
});

const safeNextPath = (value: string | undefined): string | undefined =>
    value?.startsWith("/app/") === true && !value.startsWith("//")
        ? value
        : undefined;

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;

    const formData = await request.formData();
    const credentials = credentialsSchema.safeParse({
        email: formData.get("email"),
        password: formData.get("password"),
        next: formData.get("next") || undefined,
        remember: formData.get("remember") === "on",
    });

    if (!credentials.success) {
        return NextResponse.redirect(new URL("/app/login?error=invalid", request.url), 303);
    }

    if (!(await authenticationRateLimiter.consume("login", request.headers, credentials.data.email))) {
        return NextResponse.redirect(new URL("/app/login?error=rate_limited", request.url), 303);
    }

    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    if (!(await verifyTurnstile(String(formData.get("cf-turnstile-response") ?? ""), ipAddress))) return NextResponse.redirect(new URL("/app/login?error=turnstile", request.url), 303);

    const next = safeNextPath(credentials.data.next);
    const result = await createBrowserSession({
        email: credentials.data.email,
        password: credentials.data.password,
        ipAddress,
        userAgent: request.headers.get("user-agent"),
        remember: credentials.data.remember,
        ...(next === undefined ? {} : { next }),
    });

    if (!result.ok) {
        if (result.reason === "two_factor_required" && result.challengeToken !== undefined) {
            const response = NextResponse.redirect(new URL("/app/two-factor-challenge", request.url), 303);
            response.cookies.set("relaticle_2fa_challenge", result.challengeToken, { httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 600 });
            return response;
        }
        const location = new URL("/app/login", request.url);
        location.searchParams.set("error", result.reason);

        return NextResponse.redirect(location, 303);
    }

    const destination =
        safeNextPath(credentials.data.next) ??
        (result.teamSlug === null ? "/app/new" : `/app/${result.teamSlug}`);
    const response = NextResponse.redirect(new URL(destination, request.url), 303);
    response.cookies.set(result.cookieName, result.cookieValue, {
        httpOnly: true,
        sameSite: "lax",
        secure:
            (request.headers.get("x-forwarded-proto") ??
                new URL(request.url).protocol.replace(":", "")) === "https",
        path: "/",
        maxAge: result.lifetimeSeconds,
    });
    await queueMailcoachEvent(result.userId, "login");

    return response;
};
