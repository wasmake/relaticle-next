import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { queueMailcoachEvent } from "@/server/accounts/mailcoach";
import { accountRequiresTwoFactor, resolveSocialAccount } from "@/server/accounts/service";
import { createBrowserSessionForUser, createTwoFactorChallenge } from "@/server/auth/browser/session";
import { readSignedToken } from "@/server/auth/browser/signed-token";
import { fetchSocialProfile, oauthRedirectUri, readSocialOAuthFlow, socialProviderSchema } from "@/server/auth/oauth";
import { createHttpAuthConfiguration } from "@/server/auth/http/configuration";
import { DrizzleHttpAuthRepository } from "@/server/auth/http/drizzle-repository";
import { resolveHttpIdentity } from "@/server/auth/http/resolver";
import { getDatabase } from "@/server/db/client";
import { ulidSchema } from "@/server/ids";

const finish = (request: NextRequest, destination: string): NextResponse => {
    const response = NextResponse.redirect(new URL(destination, request.url), 303);
    response.cookies.set("relaticle_oauth", "", { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/auth/oauth", maxAge: 0 });
    return response;
};

export const GET = async (request: NextRequest, { params }: { params: Promise<{ provider: string }> }): Promise<Response> => {
    const provider = socialProviderSchema((await params).provider);
    const saved = readSignedToken(request.cookies.get("relaticle_oauth")?.value ?? "");
    const flow = provider === undefined ? undefined : readSocialOAuthFlow(provider, request.nextUrl.searchParams.get("state"), saved);
    if (!provider || !flow) return finish(request, "/app/login?error=oauth_state");
    const code = request.nextUrl.searchParams.get("code");
    if (!code) return finish(request, "/app/login?error=oauth_denied");
    try {
        const redirectUri = oauthRedirectUri(provider);
        const profile = await fetchSocialProfile(provider, code, flow.verifier, redirectUri);
        const linking = ulidSchema.safeParse(flow.linkingUserId);
        if (linking.success) {
            const identity = await resolveHttpIdentity({ request: { method: "GET", headers: request.headers }, requestId: randomUUID() }, new DrizzleHttpAuthRepository(getDatabase()), createHttpAuthConfiguration());
            if (!identity.ok || identity.userId !== linking.data) return finish(request, "/app/login?error=authentication_required");
        }
        const account = await resolveSocialAccount(provider, profile, linking.success ? linking.data : undefined);
        if (linking.success) return finish(request, "/app/settings/security?oauth=linked");
        const next = flow.next?.startsWith("/app/") === true && !flow.next.startsWith("//") ? flow.next : undefined;
        if (await accountRequiresTwoFactor(account.id)) {
            const challenge = createTwoFactorChallenge(account.id, { ipAddress: null, userAgent: request.headers.get("user-agent"), ...(next === undefined ? {} : { next }) });
            if (!challenge) throw new Error("Session signing is not configured.");
            const response = finish(request, "/app/two-factor-challenge");
            response.cookies.set("relaticle_2fa_challenge", challenge, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 600 });
            return response;
        }
        const session = await createBrowserSessionForUser(account.id, { ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: request.headers.get("user-agent") });
        if (!session.ok) throw new Error(session.reason);
        const response = finish(request, next ?? (session.teamSlug ? `/app/${session.teamSlug}` : "/app/new"));
        response.cookies.set(session.cookieName, session.cookieValue, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: session.lifetimeSeconds });
        await queueMailcoachEvent(account.id, account.created ? "registration" : "login");
        return response;
    } catch {
        return finish(request, "/app/login?error=oauth_failed");
    }
};
