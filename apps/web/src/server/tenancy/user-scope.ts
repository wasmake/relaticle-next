import { or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { teams, teamUser } from "@/server/db/schema";
import type { Ulid } from "@/server/ids";

export const userBelongsToTeam = (
    userIdColumn: AnyPgColumn,
    teamId: Ulid,
): SQL => {
    const condition = or(
        sql`exists (
            select 1 from ${teams}
            where ${teams.id} = ${teamId}
              and ${teams.userId} = ${userIdColumn}
        )`,
        sql`exists (
            select 1 from ${teamUser}
            where ${teamUser.teamId} = ${teamId}
              and ${teamUser.userId} = ${userIdColumn}
        )`,
    );

    if (condition === undefined) {
        throw new Error("Unable to build team membership condition.");
    }

    return condition;
};
