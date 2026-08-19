import { NextRequest, NextResponse } from "next/server";

import { queueMailcoachEvent } from "@/server/accounts/mailcoach";
import { verifyTwoFactorChallenge } from "@/server/accounts/two-factor";
import { createBrowserSessionForUser } from "@/server/auth/browser/session";
import { consumeTwoFactorChallenge } from "@/server/auth/browser/challenge";
import { readSignedToken } from "@/server/auth/browser/signed-token";
import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { authenticationRateLimiter } from "@/server/auth/rate-limiter";
import { verifyTurnstile } from "@/server/auth/turnstile";
import { ulidSchema } from "@/server/ids";

export const POST = async (request: NextRequest): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected) return rejected;
    const challenge = readSignedToken(request.cookies.get("relaticle_2fa_challenge")?.value ?? "");
    const userId = ulidSchema.safeParse(challenge?.userId);
    const nonce = typeof challenge?.nonce === "string" ? challenge.nonce : undefined;
    const form = await request.formData();
    const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    if (!userId.success || !(await authenticationRateLimiter.consume("two-factor", request.headers, userId.data))) return NextResponse.redirect(new URL("/app/two-factor-challenge?error=rate_limited", request.url), 303);
    if (!(await verifyTurnstile(textFormValue(form, "cf-turnstile-response"), ipAddress))) return NextResponse.redirect(new URL("/app/two-factor-challenge?error=turnstile", request.url), 303);
    if (nonce === undefined || !(await verifyTwoFactorChallenge(userId.data, textFormValue(form, "code"))) || !(await consumeTwoFactorChallenge(nonce))) return NextResponse.redirect(new URL("/app/two-factor-challenge?error=invalid", request.url), 303);
    const session = await createBrowserSessionForUser(userId.data, { ipAddress, userAgent: request.headers.get("user-agent"), remember: challenge?.remember === true });
    if (!session.ok) return NextResponse.redirect(new URL("/app/login?error=session_configuration_missing", request.url), 303);
    const next = typeof challenge?.next === "string" && challenge.next.startsWith("/app/") && !challenge.next.startsWith("//") ? challenge.next : session.teamSlug ? `/app/${session.teamSlug}` : "/app/new";
    const response = NextResponse.redirect(new URL(next, request.url), 303);
    response.cookies.set(session.cookieName, session.cookieValue, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: session.lifetimeSeconds });
    response.cookies.set("relaticle_2fa_challenge", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
    await queueMailcoachEvent(userId.data, "login");
    return response;
};
