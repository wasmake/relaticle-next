import { and, desc, eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { subscriptions, teams } from "@/server/db/schema";
import type { Ulid } from "@/server/ids";

import type {
    HostedWorkspace,
    HostedWorkspaceRepository,
} from "./hosted-workspace-access";

type Database = ReturnType<typeof getDatabase>;

export class DrizzleHostedWorkspaceRepository implements HostedWorkspaceRepository {
    public constructor(private readonly database: Database = getDatabase()) {}

    public async findForAccess(teamId: Ulid): Promise<HostedWorkspace | undefined> {
        const [[team], [subscription]] = await Promise.all([
            this.database
                .select({
                    plan: teams.plan,
                    trialEndsAt: teams.trialEndsAt,
                    hostedFreeGrandfatheredAt: teams.hostedFreeGrandfatheredAt,
                })
                .from(teams)
                .where(eq(teams.id, teamId))
                .limit(1),
            this.database
                .select({
                    stripeStatus: subscriptions.stripeStatus,
                    trialEndsAt: subscriptions.trialEndsAt,
                    endsAt: subscriptions.endsAt,
                })
                .from(subscriptions)
                .where(
                    and(
                        eq(subscriptions.teamId, teamId),
                        eq(subscriptions.type, "default"),
                    ),
                )
                .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
                .limit(1),
        ]);

        if (team === undefined) {
            return undefined;
        }

        return {
            ...team,
            subscription: subscription ?? null,
        };
    }
}
