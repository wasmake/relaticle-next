import type { RequestContext, RequestCredential } from "@/server/context/request-context";
import type { Ulid } from "@/server/ids";

export const oauthScopes = ["read", "create", "update", "delete"] as const;
export type OAuthScope = (typeof oauthScopes)[number];

export type OAuthClient = Readonly<{
    id: string;
    name: string;
    redirectUris: readonly string[];
    grantTypes: readonly string[];
    revoked: boolean;
}>;

export type AuthorizationCode = Readonly<{
    id: string;
    userId: Ulid;
    clientId: string;
    teamId: Ulid;
    scopes: readonly OAuthScope[];
    redirectUri: string;
    codeChallenge: string;
    expiresAt: Date;
}>;

export type AccessToken = Readonly<{
    id: string;
    userId: Ulid;
    clientId: string;
    teamId: Ulid;
    scopes: readonly OAuthScope[];
    revoked: boolean;
    expiresAt: Date;
}>;

export type RefreshToken = Readonly<{
    id: string;
    accessTokenId: string;
    familyId: string;
    revoked: boolean;
    expiresAt: Date;
}>;

export type OAuthIdentity = Readonly<{
    context: Omit<RequestContext, "credential"> &
        Readonly<{
            credential: Extract<RequestCredential, { kind: "oauth" }>;
        }>;
    user: Readonly<{ id: Ulid; name: string; email: string }>;
    team: Readonly<{ id: Ulid; name: string; slug: string }>;
}>;

export interface OAuthRepository {
    createClient(client: OAuthClient, now: Date): Promise<void>;
    findClient(clientId: string): Promise<OAuthClient | undefined>;
    createAuthorizationCode(code: AuthorizationCode): Promise<void>;
    findAuthorizationCode(id: string): Promise<AuthorizationCode | undefined>;
    consumeAuthorizationCode(id: string, now: Date): Promise<boolean>;
    createTokenPair(
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        now: Date,
    ): Promise<void>;
    findAccessToken(id: string): Promise<AccessToken | undefined>;
    findRefreshToken(id: string): Promise<RefreshToken | undefined>;
    rotateRefreshToken(
        oldRefreshTokenId: string,
        oldAccessTokenId: string,
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        now: Date,
    ): Promise<boolean>;
    revokeAccessToken(id: string): Promise<boolean>;
    revokeRefreshToken(id: string): Promise<string | undefined>;
    revokeRefreshTokenFamily(familyId: string): Promise<void>;
    findIdentity(
        userId: Ulid,
        teamId: Ulid,
    ): Promise<
        | Readonly<{
              user: Readonly<{ id: Ulid; name: string; email: string }>;
              team: Readonly<{ id: Ulid; name: string; slug: string }>;
          }>
        | undefined
    >;
}

export class OAuthError extends Error {
    public constructor(
        public readonly code: string,
        message: string,
        public readonly status: 400 | 401 | 403 = 400,
    ) {
        super(message);
    }
}
