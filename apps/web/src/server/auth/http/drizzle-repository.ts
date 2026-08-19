import { and, eq } from "drizzle-orm";

import type { LegacySessionRecord } from "@/server/auth/compatibility/legacy-session";
import { getDatabase } from "@/server/db/client";
import {
    personalAccessTokens,
    sessions,
    teams,
    teamUser,
    users,
} from "@/server/db/schema";
import type { Ulid } from "@/server/ids";

import type {
    HttpAuthRepository,
    HttpAuthTeamRecord,
    HttpAuthUserRecord,
    PersonalAccessTokenRecord,
} from "./types";

type Database = ReturnType<typeof getDatabase>;

const toPersonalAccessTokenRecord = (
    token: typeof personalAccessTokens.$inferSelect,
): PersonalAccessTokenRecord => ({
    id: token.id.toString(),
    tokenableType: token.tokenableType,
    tokenableId: token.tokenableId,
    teamId: token.teamId,
    tokenHash: token.token,
    abilities: token.abilities,
    expiresAt: token.expiresAt,
});

export class DrizzleHttpAuthRepository implements HttpAuthRepository {
    public constructor(private readonly database: Database = getDatabase()) {}

    public async findPersonalAccessTokenById(
        tokenId: string,
    ): Promise<PersonalAccessTokenRecord | undefined> {
        const [token] = await this.database
            .select()
            .from(personalAccessTokens)
            .where(eq(personalAccessTokens.id, BigInt(tokenId)))
            .limit(1);

        return token === undefined
            ? undefined
            : toPersonalAccessTokenRecord(token);
    }

    public async findPersonalAccessTokenByHash(
        tokenHash: string,
    ): Promise<PersonalAccessTokenRecord | undefined> {
        const [token] = await this.database
            .select()
            .from(personalAccessTokens)
            .where(eq(personalAccessTokens.token, tokenHash))
            .limit(1);

        return token === undefined
            ? undefined
            : toPersonalAccessTokenRecord(token);
    }

    public async findSessionById(
        sessionId: string,
    ): Promise<LegacySessionRecord | undefined> {
        const [session] = await this.database
            .select({
                id: sessions.id,
                userId: sessions.userId,
                lastActivity: sessions.lastActivity,
                payload: sessions.payload,
            })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .limit(1);

        return session;
    }

    public async findUserById(
        userId: Ulid,
    ): Promise<HttpAuthUserRecord | undefined> {
        const [user] = await this.database
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                emailVerifiedAt: users.emailVerifiedAt,
                currentTeamId: users.currentTeamId,
                scheduledDeletionAt: users.scheduledDeletionAt,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        return user;
    }

    public async findTeamById(
        teamId: Ulid,
    ): Promise<HttpAuthTeamRecord | undefined> {
        const [team] = await this.database
            .select({
                id: teams.id,
                ownerUserId: teams.userId,
                name: teams.name,
                slug: teams.slug,
                personalTeam: teams.personalTeam,
                scheduledDeletionAt: teams.scheduledDeletionAt,
            })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1);

        return team;
    }

    public async hasTeamMembership(
        userId: Ulid,
        teamId: Ulid,
    ): Promise<boolean> {
        const [membership] = await this.database
            .select({ id: teamUser.id })
            .from(teamUser)
            .where(
                and(
                    eq(teamUser.userId, userId),
                    eq(teamUser.teamId, teamId),
                ),
            )
            .limit(1);

        return membership !== undefined;
    }
}
