import type {
    HttpAuthConfiguration,
    HttpAuthRepository,
    HttpAuthResult,
    HttpAuthSuccess,
} from "@/server/auth/http";
import {
    authorizeHttpIdentity,
    resolveHttpIdentity,
} from "@/server/auth/http";
import type { HostedWorkspaceAccess } from "@/server/billing/hosted-workspace-access";
import type { Environment } from "@/server/env";

import type { ApiRateLimiter } from "./rate-limiter";

export type ApiAccessAllowed = Readonly<{
    allowed: true;
    authentication: HttpAuthSuccess;
    headers: Readonly<Record<string, string>>;
}>;

export type ApiAccessDenied = Readonly<{
    allowed: false;
    status: 401 | 402 | 403 | 429;
    body: unknown;
    headers: Readonly<Record<string, string>>;
}>;

export type ApiAccessResult = ApiAccessAllowed | ApiAccessDenied;

export interface ApiAccessResolver {
    resolve(request: Request, requestId: string): Promise<ApiAccessResult>;
}

const deniedAuthentication = (
    status: 401 | 403,
    headers: Readonly<Record<string, string>> = {},
): ApiAccessDenied => ({
    allowed: false,
    status,
    body: { message: status === 401 ? "Unauthenticated." : "Forbidden." },
    headers,
});

export const apiAccessFromHttpAuthResult = (
    result: HttpAuthResult,
): ApiAccessResult =>
    result.ok
        ? {
              allowed: true,
              authentication: result,
              headers: {},
          }
        : deniedAuthentication(result.failure.status);

const billingUrlFor = (environment: Environment, teamSlug: string): string => {
    const appUrl = new URL(environment.APP_URL);
    const encodedSlug = encodeURIComponent(teamSlug);

    if (environment.APP_PANEL_DOMAIN !== undefined) {
        const port = appUrl.port === "" ? "" : `:${appUrl.port}`;

        return `${appUrl.protocol}//${environment.APP_PANEL_DOMAIN}${port}/${encodedSlug}/billing`;
    }

    const panelPath = environment.APP_PANEL_PATH.replace(/^\/+|\/+$/gu, "");

    return `${environment.APP_URL.replace(/\/+$/gu, "")}/${panelPath}/${encodedSlug}/billing`;
};

export class ProductionApiAccessResolver implements ApiAccessResolver {
    public constructor(
        private readonly authRepository: HttpAuthRepository,
        private readonly authConfiguration: HttpAuthConfiguration,
        private readonly rateLimiter: ApiRateLimiter,
        private readonly hostedAccess: HostedWorkspaceAccess,
        private readonly environment: Environment,
    ) {}

    public async resolve(
        request: Request,
        requestId: string,
    ): Promise<ApiAccessResult> {
        const input = { request, requestId } as const;
        const identity = await resolveHttpIdentity(
            input,
            this.authRepository,
            this.authConfiguration,
        );

        if (!identity.ok) {
            return deniedAuthentication(identity.failure.status);
        }

        const rateLimit = await this.rateLimiter.consume(request, identity);

        if (!rateLimit.allowed) {
            return {
                allowed: false,
                status: 429,
                body: { message: "Too Many Attempts." },
                headers: rateLimit.headers,
            };
        }

        const authentication = await authorizeHttpIdentity(
            input,
            identity,
            this.authRepository,
        );

        if (!authentication.ok) {
            const rateLimitedTeamFailure = [
                "team_not_found",
                "team_scheduled_for_deletion",
                "team_membership_required",
            ].includes(authentication.failure.reason);

            return deniedAuthentication(
                authentication.failure.status,
                rateLimitedTeamFailure ? rateLimit.headers : {},
            );
        }

        if (!(await this.hostedAccess.allows(authentication.context.teamId))) {
            return {
                allowed: false,
                status: 402,
                body: {
                    error: "workspace_subscription_required",
                    message:
                        "This workspace is paused. Subscribe to Cloud Pro to restore access.",
                    upgrade_url: billingUrlFor(
                        this.environment,
                        authentication.team.slug,
                    ),
                },
                headers: rateLimit.headers,
            };
        }

        return {
            allowed: true,
            authentication,
            headers: rateLimit.headers,
        };
    }
}
