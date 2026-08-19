import { and, desc, eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { personalAccessTokens } from "@/server/db/schema";
import type { Ulid } from "@/server/ids";

import type { PersonalAccessTokensRepository } from "./repository";
import type { CreatePersonalAccessTokenInput, PersonalAccessTokenView } from "./types";

type Database = ReturnType<typeof getDatabase>;
type TokenRow = typeof personalAccessTokens.$inferSelect;

const view = (row: TokenRow): PersonalAccessTokenView => {
    let abilities: unknown = [];
    try {
        abilities = row.abilities === null ? [] : JSON.parse(row.abilities);
    } catch {
        abilities = [];
    }

    return {
        id: row.id.toString(),
        name: row.name,
        abilities: Array.isArray(abilities)
            ? abilities.filter((ability): ability is string => typeof ability === "string")
            : [],
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
};

export class DrizzlePersonalAccessTokensRepository implements PersonalAccessTokensRepository {
    public constructor(private readonly database: Database = getDatabase()) {}

    public async list(userId: Ulid, teamId: Ulid): Promise<readonly PersonalAccessTokenView[]> {
        const rows = await this.database
            .select()
            .from(personalAccessTokens)
            .where(
                and(
                    eq(personalAccessTokens.tokenableType, "user"),
                    eq(personalAccessTokens.tokenableId, userId),
                    eq(personalAccessTokens.teamId, teamId),
                ),
            )
            .orderBy(desc(personalAccessTokens.createdAt), desc(personalAccessTokens.id));
        return rows.map(view);
    }

    public async create(input: CreatePersonalAccessTokenInput): Promise<PersonalAccessTokenView> {
        const [row] = await this.database
            .insert(personalAccessTokens)
            .values({
                tokenableType: "user",
                tokenableId: input.userId,
                teamId: input.teamId,
                name: input.name,
                token: input.tokenHash,
                abilities: JSON.stringify(input.abilities),
                expiresAt: input.expiresAt,
                createdAt: input.occurredAt,
                updatedAt: input.occurredAt,
            })
            .returning();

        if (row === undefined) {
            throw new Error("Personal access token insert did not return a row.");
        }
        return view(row);
    }

    public async delete(userId: Ulid, teamId: Ulid, tokenId: string): Promise<boolean> {
        const rows = await this.database
            .delete(personalAccessTokens)
            .where(
                and(
                    eq(personalAccessTokens.id, BigInt(tokenId)),
                    eq(personalAccessTokens.tokenableType, "user"),
                    eq(personalAccessTokens.tokenableId, userId),
                    eq(personalAccessTokens.teamId, teamId),
                ),
            )
            .returning({ id: personalAccessTokens.id });
        return rows.length > 0;
    }
}
