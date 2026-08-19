import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import {
    oauthAccessTokens,
    oauthAuthCodes,
    oauthClients,
    oauthRefreshTokens,
    teams,
    teamUser,
    users,
} from "@/server/db/schema";
import type { Ulid } from "@/server/ids";

import { oauthScopes, type OAuthScope } from "./types";
import type {
    AccessToken,
    AuthorizationCode,
    OAuthClient,
    OAuthRepository,
    RefreshToken,
} from "./types";

type Database = ReturnType<typeof getDatabase>;

const stringArray = (value: string | null): readonly string[] => {
    if (value === null) {
        return [];
    }

    try {
        const parsed = JSON.parse(value) as unknown;
        return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
            ? parsed
            : [];
    } catch {
        return value.split(/\s+/u).filter(Boolean);
    }
};

const scopesFrom = (value: string | null): readonly OAuthScope[] =>
    stringArray(value).filter((scope): scope is OAuthScope =>
        oauthScopes.includes(scope as OAuthScope),
    );

type CodeEnvelope = Readonly<{
    version: 1;
    scopes: readonly OAuthScope[];
    redirectUri: string;
    codeChallenge: string;
}>;

const decodeCode = (value: string | null): CodeEnvelope | undefined => {
    try {
        const parsed = JSON.parse(value ?? "") as Partial<CodeEnvelope>;
        if (
            parsed.version !== 1 ||
            !Array.isArray(parsed.scopes) ||
            !parsed.scopes.every((scope) => oauthScopes.includes(scope)) ||
            typeof parsed.redirectUri !== "string" ||
            typeof parsed.codeChallenge !== "string"
        ) {
            return undefined;
        }

        return parsed as CodeEnvelope;
    } catch {
        return undefined;
    }
};

export class DrizzleOAuthRepository implements OAuthRepository {
    public constructor(private readonly database: Database = getDatabase()) {}

    public async createClient(client: OAuthClient, now: Date): Promise<void> {
        await this.database.insert(oauthClients).values({
            id: client.id,
            name: client.name,
            redirectUris: JSON.stringify(client.redirectUris),
            grantTypes: JSON.stringify(client.grantTypes),
            revoked: client.revoked,
            createdAt: now,
            updatedAt: now,
        });
    }

    public async findClient(clientId: string): Promise<OAuthClient | undefined> {
        const [client] = await this.database
            .select()
            .from(oauthClients)
            .where(eq(oauthClients.id, clientId))
            .limit(1);

        return client === undefined
            ? undefined
            : {
                  id: client.id,
                  name: client.name,
                  redirectUris: stringArray(client.redirectUris),
                  grantTypes: stringArray(client.grantTypes),
                  revoked: client.revoked,
              };
    }

    public async createAuthorizationCode(code: AuthorizationCode): Promise<void> {
        await this.database.insert(oauthAuthCodes).values({
            id: code.id,
            userId: code.userId,
            clientId: code.clientId,
            teamId: code.teamId,
            scopes: JSON.stringify({
                version: 1,
                scopes: code.scopes,
                redirectUri: code.redirectUri,
                codeChallenge: code.codeChallenge,
            } satisfies CodeEnvelope),
            revoked: false,
            expiresAt: code.expiresAt,
        });
    }

    public async findAuthorizationCode(id: string): Promise<AuthorizationCode | undefined> {
        const [code] = await this.database
            .select()
            .from(oauthAuthCodes)
            .where(and(eq(oauthAuthCodes.id, id), eq(oauthAuthCodes.revoked, false)))
            .limit(1);
        const envelope = decodeCode(code?.scopes ?? null);

        if (code === undefined || code.teamId === null || code.expiresAt === null || envelope === undefined) {
            return undefined;
        }

        return {
            id: code.id,
            userId: code.userId,
            clientId: code.clientId,
            teamId: code.teamId,
            expiresAt: code.expiresAt,
            ...envelope,
        };
    }

    public async consumeAuthorizationCode(id: string, now: Date): Promise<boolean> {
        const consumed = await this.database
            .update(oauthAuthCodes)
            .set({ revoked: true })
            .where(
                and(
                    eq(oauthAuthCodes.id, id),
                    eq(oauthAuthCodes.revoked, false),
                    gt(oauthAuthCodes.expiresAt, now),
                ),
            )
            .returning({ id: oauthAuthCodes.id });

        return consumed.length === 1;
    }

    public async createTokenPair(
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        now: Date,
    ): Promise<void> {
        await this.database.transaction(async (transaction) => {
            await transaction.insert(oauthAccessTokens).values({
                ...accessToken,
                scopes: JSON.stringify(accessToken.scopes),
                createdAt: now,
                updatedAt: now,
            });
            await transaction.insert(oauthRefreshTokens).values(refreshToken);
        });
    }

    public async findAccessToken(id: string): Promise<AccessToken | undefined> {
        const [token] = await this.database
            .select()
            .from(oauthAccessTokens)
            .where(eq(oauthAccessTokens.id, id))
            .limit(1);

        if (token === undefined || token.userId === null || token.teamId === null || token.expiresAt === null) {
            return undefined;
        }

        return {
            id: token.id,
            userId: token.userId,
            clientId: token.clientId,
            teamId: token.teamId,
            scopes: scopesFrom(token.scopes),
            revoked: token.revoked,
            expiresAt: token.expiresAt,
        };
    }

    public async findRefreshToken(id: string): Promise<RefreshToken | undefined> {
        const [token] = await this.database
            .select()
            .from(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.id, id))
            .limit(1);

        return token === undefined || token.expiresAt === null
            ? undefined
            : { ...token, expiresAt: token.expiresAt };
    }

    public async rotateRefreshToken(
        oldRefreshTokenId: string,
        oldAccessTokenId: string,
        accessToken: AccessToken,
        refreshToken: RefreshToken,
        now: Date,
    ): Promise<boolean> {
        return this.database.transaction(async (transaction) => {
            const consumed = await transaction
                .update(oauthRefreshTokens)
                .set({ revoked: true })
                .where(
                    and(
                        eq(oauthRefreshTokens.id, oldRefreshTokenId),
                        eq(oauthRefreshTokens.revoked, false),
                        gt(oauthRefreshTokens.expiresAt, now),
                    ),
                )
                .returning({ id: oauthRefreshTokens.id });

            if (consumed.length !== 1) {
                return false;
            }

            await transaction
                .update(oauthAccessTokens)
                .set({ revoked: true, updatedAt: now })
                .where(eq(oauthAccessTokens.id, oldAccessTokenId));
            await transaction.insert(oauthAccessTokens).values({
                ...accessToken,
                scopes: JSON.stringify(accessToken.scopes),
                createdAt: now,
                updatedAt: now,
            });
            await transaction.insert(oauthRefreshTokens).values(refreshToken);
            return true;
        });
    }

    public async revokeAccessToken(id: string): Promise<boolean> {
        const revoked = await this.database
            .update(oauthAccessTokens)
            .set({ revoked: true, updatedAt: new Date() })
            .where(eq(oauthAccessTokens.id, id))
            .returning({ id: oauthAccessTokens.id });
        return revoked.length > 0;
    }

    public async revokeRefreshToken(id: string): Promise<string | undefined> {
        const [revoked] = await this.database
            .update(oauthRefreshTokens)
            .set({ revoked: true })
            .where(eq(oauthRefreshTokens.id, id))
            .returning({ accessTokenId: oauthRefreshTokens.accessTokenId });
        return revoked?.accessTokenId;
    }

    public async revokeRefreshTokenFamily(familyId: string): Promise<void> {
        await this.database.transaction(async (transaction) => {
            const family = await transaction
                .update(oauthRefreshTokens)
                .set({ revoked: true })
                .where(eq(oauthRefreshTokens.familyId, familyId))
                .returning({ accessTokenId: oauthRefreshTokens.accessTokenId });
            const accessTokenIds = family.map(({ accessTokenId }) => accessTokenId);
            if (accessTokenIds.length > 0) {
                await transaction.update(oauthAccessTokens).set({ revoked: true, updatedAt: new Date() }).where(inArray(oauthAccessTokens.id, accessTokenIds));
            }
        });
    }

    public async findIdentity(userId: Ulid, teamId: Ulid) {
        const [identity] = await this.database
            .select({
                userId: users.id,
                userName: users.name,
                userEmail: users.email,
                teamId: teams.id,
                teamName: teams.name,
                teamSlug: teams.slug,
            })
            .from(users)
            .innerJoin(teams, eq(teams.id, teamId))
            .leftJoin(
                teamUser,
                and(eq(teamUser.teamId, teamId), eq(teamUser.userId, userId)),
            )
            .where(
                and(
                    eq(users.id, userId),
                    isNull(users.scheduledDeletionAt),
                    isNull(teams.scheduledDeletionAt),
                    or(eq(teams.userId, userId), eq(teamUser.userId, userId)),
                ),
            )
            .limit(1);

        return identity === undefined
            ? undefined
            : {
                  user: { id: identity.userId, name: identity.userName, email: identity.userEmail },
                  team: { id: identity.teamId, name: identity.teamName, slug: identity.teamSlug },
              };
    }
}
