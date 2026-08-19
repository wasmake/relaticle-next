import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { createRequestContext } from "@/server/context/request-context";
import { ulidSchema, type Ulid } from "@/server/ids";

import {
    OAuthError,
    oauthScopes,
    type AccessToken,
    type AuthorizationCode,
    type OAuthClient,
    type OAuthIdentity,
    type OAuthRepository,
    type OAuthScope,
    type RefreshToken,
} from "./types";

const ACCESS_TOKEN_SECONDS = 3_600;
const REFRESH_TOKEN_SECONDS = 60 * 60 * 24 * 30;
const AUTHORIZATION_CODE_SECONDS = 600;
const tokenPattern = /^[A-Za-z0-9._~-]{43,128}$/u;
const challengePattern = /^[A-Za-z0-9_-]{43,128}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const hash = (value: string): string =>
    createHash("sha256").update(value, "utf8").digest("hex");

const opaqueToken = (prefix: string): string =>
    `${prefix}${randomBytes(32).toString("base64url")}`;

const expiresAt = (now: Date, seconds: number): Date =>
    new Date(now.getTime() + seconds * 1_000);

const constantTimeEqual = (left: string, right: string): boolean => {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);

    return (
        leftBytes.length === rightBytes.length &&
        timingSafeEqual(leftBytes, rightBytes)
    );
};

export const parseScopes = (value: string | undefined): readonly OAuthScope[] => {
    const requested = value?.trim() === "" || value === undefined
        ? ["read"]
        : value.trim().split(/\s+/u);

    if (requested.some((scope) => !oauthScopes.includes(scope as OAuthScope))) {
        throw new OAuthError("invalid_scope", "One or more requested scopes are unsupported.");
    }

    return [...new Set(requested)] as OAuthScope[];
};

const validRedirectUri = (value: string): boolean => {
    try {
        const uri = new URL(value);
        const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname);

        return (
            uri.hash === "" &&
            uri.username === "" &&
            uri.password === "" &&
            (uri.protocol === "https:" || (uri.protocol === "http:" && loopback))
        );
    } catch {
        return false;
    }
};

export class OAuthService {
    public constructor(
        private readonly repository: OAuthRepository,
        private readonly now: () => Date = () => new Date(),
    ) {}

    public async registerClient(input: Readonly<{
        clientName: string;
        redirectUris: readonly string[];
        grantTypes?: readonly string[];
        tokenEndpointAuthMethod?: string;
    }>): Promise<OAuthClient> {
        const grantTypes = input.grantTypes ?? ["authorization_code", "refresh_token"];

        if (
            input.clientName.trim() === "" ||
            input.clientName.length > 255 ||
            input.redirectUris.length === 0 ||
            !input.redirectUris.every(validRedirectUri) ||
            grantTypes.some((grant) => !["authorization_code", "refresh_token"].includes(grant)) ||
            (input.tokenEndpointAuthMethod ?? "none") !== "none"
        ) {
            throw new OAuthError("invalid_client_metadata", "Client metadata is invalid.");
        }

        const client: OAuthClient = {
            id: randomUUID(),
            name: input.clientName.trim(),
            redirectUris: [...new Set(input.redirectUris)],
            grantTypes: [...new Set(grantTypes)],
            revoked: false,
        };
        await this.repository.createClient(client, this.now());

        return client;
    }

    public async validateAuthorization(input: Readonly<{
        clientId: string;
        redirectUri: string;
        responseType: string;
        codeChallenge: string;
        codeChallengeMethod: string;
        scope?: string;
    }>): Promise<Readonly<{ client: OAuthClient; scopes: readonly OAuthScope[] }>> {
        if (!uuidPattern.test(input.clientId)) {
            throw new OAuthError("invalid_request", "The client is invalid.");
        }

        const client = await this.repository.findClient(input.clientId);

        if (client === undefined || client.revoked) {
            throw new OAuthError("invalid_request", "The client is invalid.");
        }

        if (!client.redirectUris.includes(input.redirectUri)) {
            throw new OAuthError("invalid_request", "The redirect URI is invalid.");
        }

        if (
            input.responseType !== "code" ||
            input.codeChallengeMethod !== "S256" ||
            !challengePattern.test(input.codeChallenge)
        ) {
            throw new OAuthError("invalid_request", "Authorization code flow with S256 PKCE is required.");
        }

        return { client, scopes: parseScopes(input.scope) };
    }

    public async authorize(input: Readonly<{
        userId: Ulid;
        teamId: Ulid;
        clientId: string;
        redirectUri: string;
        codeChallenge: string;
        scopes: readonly OAuthScope[];
    }>): Promise<string> {
        const plainCode = opaqueToken("crm_ac_");
        await this.repository.createAuthorizationCode({
            id: hash(plainCode),
            userId: input.userId,
            teamId: input.teamId,
            clientId: input.clientId,
            redirectUri: input.redirectUri,
            codeChallenge: input.codeChallenge,
            scopes: input.scopes,
            expiresAt: expiresAt(this.now(), AUTHORIZATION_CODE_SECONDS),
        });

        return plainCode;
    }

    public async exchangeAuthorizationCode(input: Readonly<{
        code: string;
        clientId: string;
        redirectUri: string;
        codeVerifier: string;
    }>): Promise<Readonly<Record<string, unknown>>> {
        if (!tokenPattern.test(input.codeVerifier)) {
            throw new OAuthError("invalid_grant", "The authorization code or verifier is invalid.");
        }

        const codeId = hash(input.code);
        const code = await this.repository.findAuthorizationCode(codeId);
        const now = this.now();
        const expectedChallenge = createHash("sha256")
            .update(input.codeVerifier, "ascii")
            .digest("base64url");

        if (
            code === undefined ||
            code.expiresAt.getTime() <= now.getTime() ||
            code.clientId !== input.clientId ||
            code.redirectUri !== input.redirectUri ||
            !constantTimeEqual(code.codeChallenge, expectedChallenge) ||
            !(await this.repository.consumeAuthorizationCode(codeId, now))
        ) {
            throw new OAuthError("invalid_grant", "The authorization code or verifier is invalid.");
        }

        return this.issueTokenPair(code, now);
    }

    public async exchangeRefreshToken(input: Readonly<{
        refreshToken: string;
        clientId: string;
        scope?: string;
    }>): Promise<Readonly<Record<string, unknown>>> {
        const refreshTokenId = hash(input.refreshToken);
        const refreshToken = await this.repository.findRefreshToken(refreshTokenId);
        const now = this.now();

        if (refreshToken === undefined || refreshToken.expiresAt <= now) {
            throw new OAuthError("invalid_grant", "The refresh token is invalid.");
        }

        const oldAccessToken = await this.repository.findAccessToken(refreshToken.accessTokenId);

        if (oldAccessToken === undefined || oldAccessToken.clientId !== input.clientId) {
            throw new OAuthError("invalid_grant", "The refresh token is invalid.");
        }

        if (refreshToken.revoked) {
            await this.repository.revokeRefreshTokenFamily(refreshToken.familyId);
            throw new OAuthError("invalid_grant", "The refresh token is invalid.");
        }

        const scopes = input.scope === undefined ? oldAccessToken.scopes : parseScopes(input.scope);

        if (scopes.some((scope) => !oldAccessToken.scopes.includes(scope))) {
            throw new OAuthError("invalid_scope", "A refresh token cannot increase its scopes.");
        }

        const pair = this.buildTokenPair({ ...oldAccessToken, scopes }, now, refreshToken.familyId);
        const rotated = await this.repository.rotateRefreshToken(
            refreshTokenId,
            oldAccessToken.id,
            pair.accessToken,
            pair.refreshToken,
            now,
        );

        if (!rotated) {
            await this.repository.revokeRefreshTokenFamily(refreshToken.familyId);
            throw new OAuthError("invalid_grant", "The refresh token is invalid.");
        }

        return this.tokenResponse(pair, scopes);
    }

    public async revoke(token: string, clientId: string): Promise<void> {
        const tokenId = hash(token);
        const refreshToken = await this.repository.findRefreshToken(tokenId);

        if (refreshToken !== undefined) {
            const accessToken = await this.repository.findAccessToken(refreshToken.accessTokenId);

            if (accessToken?.clientId !== clientId) {
                return;
            }

            const accessTokenId = await this.repository.revokeRefreshToken(tokenId);

            if (accessTokenId !== undefined) {
                await this.repository.revokeAccessToken(accessTokenId);
            }
            return;
        }

        const accessToken = await this.repository.findAccessToken(tokenId);
        if (accessToken?.clientId === clientId) {
            await this.repository.revokeAccessToken(tokenId);
        }
    }

    public async authenticate(
        authorization: string | null,
        requestId: string,
    ): Promise<OAuthIdentity> {
        const match = /^Bearer[\t ]+([^\s,]+)$/iu.exec(authorization ?? "");

        if (match?.[1] === undefined) {
            throw new OAuthError("invalid_token", "A bearer token is required.", 401);
        }

        const token = await this.repository.findAccessToken(hash(match[1]));
        const now = this.now();

        if (token === undefined || token.revoked || token.expiresAt <= now) {
            throw new OAuthError("invalid_token", "The bearer token is invalid or expired.", 401);
        }

        const identity = await this.repository.findIdentity(token.userId, token.teamId);

        if (identity === undefined) {
            throw new OAuthError("invalid_token", "The token workspace is no longer available.", 401);
        }

        const context = createRequestContext({
            requestId,
            userId: token.userId,
            teamId: token.teamId,
            credential: { kind: "oauth", tokenId: token.id, scopes: token.scopes },
        });

        if (context.credential.kind !== "oauth") {
            throw new Error("OAuth authentication produced an invalid request context.");
        }

        return {
            ...identity,
            context: { ...context, credential: context.credential },
        };
    }

    private async issueTokenPair(
        source: Pick<AuthorizationCode, "userId" | "clientId" | "teamId" | "scopes">,
        now: Date,
    ): Promise<Readonly<Record<string, unknown>>> {
        const pair = this.buildTokenPair(source, now);
        await this.repository.createTokenPair(pair.accessToken, pair.refreshToken, now);

        return this.tokenResponse(pair, source.scopes);
    }

    private buildTokenPair(
        source: Pick<AccessToken, "userId" | "clientId" | "teamId" | "scopes">,
        now: Date,
        familyId?: string,
    ) {
        const plainAccessToken = opaqueToken("crm_at_");
        const plainRefreshToken = opaqueToken("crm_rt_");
        const accessToken: AccessToken = {
            ...source,
            id: hash(plainAccessToken),
            revoked: false,
            expiresAt: expiresAt(now, ACCESS_TOKEN_SECONDS),
        };
        const refreshToken: RefreshToken = {
            id: hash(plainRefreshToken),
            accessTokenId: accessToken.id,
            familyId: familyId ?? hash(plainRefreshToken),
            revoked: false,
            expiresAt: expiresAt(now, REFRESH_TOKEN_SECONDS),
        };

        return { plainAccessToken, plainRefreshToken, accessToken, refreshToken };
    }

    private tokenResponse(
        pair: ReturnType<OAuthService["buildTokenPair"]>,
        scopes: readonly OAuthScope[],
    ): Readonly<Record<string, unknown>> {
        return {
            access_token: pair.plainAccessToken,
            token_type: "Bearer",
            expires_in: ACCESS_TOKEN_SECONDS,
            refresh_token: pair.plainRefreshToken,
            scope: scopes.join(" "),
        };
    }
}

export const parseTeamId = (value: string | null): Ulid => {
    const parsed = ulidSchema.safeParse(value);

    if (!parsed.success) {
        throw new OAuthError("invalid_request", "A valid team_id is required.");
    }

    return parsed.data;
};
