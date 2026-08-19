import { createHash, randomBytes } from "node:crypto";

import { getEnvironment, type Environment } from "@/server/env";

export type SocialProvider = "github" | "google";
export type SocialProfile = Readonly<{ id: string; email: string; name: string; emailVerified: boolean }>;
export type SocialOAuthFlow = Readonly<{ provider: SocialProvider; verifier: string; next?: string; linkingUserId?: string }>;
type ProviderConfiguration = Readonly<{ clientId: string; clientSecret: string; authorizationUrl: string; tokenUrl: string; scope: string }>;

export const socialProviderSchema = (value: string): SocialProvider | undefined =>
    value === "github" || value === "google" ? value : undefined;

export const readSocialOAuthFlow = (provider: SocialProvider, state: string | null, value: Readonly<Record<string, unknown>> | undefined): SocialOAuthFlow | undefined => {
    if (value?.provider !== provider || typeof value.state !== "string" || value.state === "" || value.state !== state || typeof value.verifier !== "string") return undefined;
    return {
        provider,
        verifier: value.verifier,
        ...(typeof value.next === "string" ? { next: value.next } : {}),
        ...(typeof value.linkingUserId === "string" ? { linkingUserId: value.linkingUserId } : {}),
    };
};

export const oauthConfiguration = (provider: SocialProvider, environment: Environment = getEnvironment()): ProviderConfiguration | undefined => {
    if (provider === "github" && environment.GITHUB_CLIENT_ID && environment.GITHUB_CLIENT_SECRET) return { clientId: environment.GITHUB_CLIENT_ID, clientSecret: environment.GITHUB_CLIENT_SECRET, authorizationUrl: "https://github.com/login/oauth/authorize", tokenUrl: "https://github.com/login/oauth/access_token", scope: "read:user user:email" };
    if (provider === "google" && environment.GOOGLE_CLIENT_ID && environment.GOOGLE_CLIENT_SECRET) return { clientId: environment.GOOGLE_CLIENT_ID, clientSecret: environment.GOOGLE_CLIENT_SECRET, authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: "https://oauth2.googleapis.com/token", scope: "openid email profile" };
    return undefined;
};

export const createPkce = (): Readonly<{ verifier: string; challenge: string }> => {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

export const oauthRedirectUri = (provider: SocialProvider, environment: Environment = getEnvironment()): string =>
    new URL(`/auth/oauth/${provider}/callback`, environment.APP_URL).toString();

export const authorizationUrl = (provider: SocialProvider, redirectUri: string, state: string, challenge: string, environment: Environment = getEnvironment()): string | undefined => {
    const configuration = oauthConfiguration(provider, environment);
    if (configuration === undefined) return undefined;
    const url = new URL(configuration.authorizationUrl);
    url.search = new URLSearchParams({ client_id: configuration.clientId, redirect_uri: redirectUri, response_type: "code", scope: configuration.scope, state, code_challenge: challenge, code_challenge_method: "S256", ...(provider === "google" ? { access_type: "online", prompt: "select_account" } : {}) }).toString();
    return url.toString();
};

export const fetchSocialProfile = async (provider: SocialProvider, code: string, verifier: string, redirectUri: string, request: typeof fetch = fetch, environment: Environment = getEnvironment()): Promise<SocialProfile> => {
    const configuration = oauthConfiguration(provider, environment);
    if (configuration === undefined) throw new Error("OAuth provider is not configured.");
    const tokenResponse = await request(configuration.tokenUrl, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: configuration.clientId, client_secret: configuration.clientSecret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }), signal: AbortSignal.timeout(10_000) });
    if (!tokenResponse.ok) throw new Error(`OAuth token exchange returned HTTP ${tokenResponse.status}.`);
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) throw new Error("OAuth token exchange did not return an access token.");
    const headers = { authorization: `Bearer ${token.access_token}`, accept: "application/json", "user-agent": "Relaticle" };
    if (provider === "google") {
        const response = await request("https://openidconnect.googleapis.com/v1/userinfo", { headers, signal: AbortSignal.timeout(10_000) });
        const value = await response.json() as { sub?: string; email?: string; name?: string; email_verified?: boolean };
        if (!response.ok || !value.sub || !value.email) throw new Error("Google did not return a usable profile.");
        return { id: value.sub, email: value.email.toLowerCase(), name: value.name ?? value.email, emailVerified: value.email_verified === true };
    }
    const response = await request("https://api.github.com/user", { headers, signal: AbortSignal.timeout(10_000) });
    const value = await response.json() as { id?: number; email?: string | null; name?: string | null; login?: string };
    if (!response.ok || value.id === undefined) throw new Error("GitHub did not return a usable profile.");
    const emailsResponse = await request("https://api.github.com/user/emails", { headers, signal: AbortSignal.timeout(10_000) });
    if (!emailsResponse.ok) throw new Error("GitHub email verification failed.");
    const emails = await emailsResponse.json() as readonly { email?: string; primary?: boolean; verified?: boolean }[];
    const selected = emails.find((candidate) => candidate.email?.toLowerCase() === value.email?.toLowerCase() && candidate.verified) ?? emails.find((candidate) => candidate.primary && candidate.verified) ?? emails.find((candidate) => candidate.verified);
    const email = selected?.email;
    const verified = selected?.verified === true;
    if (!email) throw new Error("GitHub account has no verified email address.");
    return { id: String(value.id), email: email.toLowerCase(), name: value.name ?? value.login ?? email, emailVerified: verified };
};
