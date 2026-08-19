import { randomBytes, randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { createPkce, authorizationUrl, oauthRedirectUri, socialProviderSchema } from "@/server/auth/oauth";
import { createSignedToken } from "@/server/auth/browser/signed-token";
import { resolveHttpIdentity } from "@/server/auth/http/resolver";
import { createHttpAuthConfiguration } from "@/server/auth/http/configuration";
import { DrizzleHttpAuthRepository } from "@/server/auth/http/drizzle-repository";
import { getDatabase } from "@/server/db/client";

export const GET = async (request: NextRequest, { params }: { params: Promise<{ provider: string }> }): Promise<Response> => {
    const provider = socialProviderSchema((await params).provider);
    if (provider === undefined) return new Response("Unknown OAuth provider.", { status: 404 });
    const state = randomBytes(24).toString("base64url");
    const pkce = createPkce();
    const next = request.nextUrl.searchParams.get("next");
    const linking = request.nextUrl.searchParams.get("link") === "1";
    const identity = linking ? await resolveHttpIdentity({ request: { method: "GET", headers: request.headers }, requestId: randomUUID() }, new DrizzleHttpAuthRepository(getDatabase()), createHttpAuthConfiguration()) : undefined;
    if (linking && identity?.ok !== true) return NextResponse.redirect(new URL("/app/login?error=authentication_required", request.url), 303);
    const token = createSignedToken({ provider, state, verifier: pkce.verifier, next: next?.startsWith("/app/") && !next.startsWith("//") ? next : undefined, linkingUserId: identity?.ok === true ? identity.userId : undefined, expiresAt: Date.now() + 10 * 60_000 });
    const redirectUri = oauthRedirectUri(provider);
    const destination = authorizationUrl(provider, redirectUri, state, pkce.challenge);
    if (!token || !destination) return NextResponse.redirect(new URL("/app/login?error=oauth_configuration", request.url), 303);
    const response = NextResponse.redirect(destination);
    response.cookies.set("relaticle_oauth", token, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/auth/oauth", maxAge: 600 });
    return response;
};
