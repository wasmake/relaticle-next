import { createHttpAuthConfiguration, DrizzleHttpAuthRepository, resolveHttpAuth } from "@/server/auth/http";

import { DrizzleOAuthRepository } from "./drizzle-repository";
import { OAuthService } from "./service";

export const productionOAuthService = new OAuthService(new DrizzleOAuthRepository());

export const authorizeBrowserOAuthRequest = async (
    request: Request,
    teamId: string,
    requestId: string,
) => {
    const headers = new Headers(request.headers);
    headers.set("x-team-id", teamId);
    return resolveHttpAuth(
        { request: { method: "GET", headers }, requestId },
        new DrizzleHttpAuthRepository(),
        createHttpAuthConfiguration(),
    );
};
