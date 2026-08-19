import { rm, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import postgres, { type JSONValue } from "postgres";
import { ulid } from "ulidx";

import type { SchedulerEnvironment } from "./environment.js";
import { schedulerDatabaseUrl } from "./environment.js";

export type SchedulerSqlClient = ReturnType<typeof postgres>;

export const createSchedulerSqlClient = (
    environment: SchedulerEnvironment,
): SchedulerSqlClient =>
    postgres(schedulerDatabaseUrl(environment), {
        max: environment.DB_POOL_MAX,
        idle_timeout: 20,
        connect_timeout: 10,
        prepare: false,
    });

export interface CleanupRepository {
    deleteExpiredInvitations(cutoff: Date): Promise<number>;
    deleteOldActivity(cutoff: Date): Promise<number>;
    expirePendingActions(now: Date): Promise<number>;
    releaseOrphanedReservations(cutoff: Date, limit: number): Promise<number>;
    pruneQueueBatches(cutoffEpochSeconds: number): Promise<number>;
    cleanupImports(
        staleCutoff: Date,
        terminalCutoff: Date,
        signal: AbortSignal,
    ): Promise<number>;
}

type IdentifierRow = Readonly<{ id: string; team_id?: string | null }>;
type ReservationRow = Readonly<{
    team_id: string;
    conversation_id: string | null;
    idempotency_key: string;
    credits_charged: number;
}>;

const removePath = async (path: string): Promise<boolean> => {
    try {
        await rm(path, { recursive: false, force: false });
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return false;
        }

        throw error;
    }
};

export class PostgresCleanupRepository implements CleanupRepository {
    private readonly importsPath: string;

    public constructor(
        private readonly sql: SchedulerSqlClient,
        importsPath: string,
    ) {
        this.importsPath = resolve(importsPath);
    }

    public async deleteExpiredInvitations(cutoff: Date): Promise<number> {
        const rows = await this.sql<readonly IdentifierRow[]>`
            delete from team_invitations
            where expires_at < ${cutoff}
               or (expires_at is null and created_at < ${cutoff})
            returning id
        `;
        return rows.length;
    }

    public async deleteOldActivity(cutoff: Date): Promise<number> {
        const rows = await this.sql<readonly IdentifierRow[]>`
            delete from activity_log
            where created_at < ${cutoff}
            returning id
        `;
        return rows.length;
    }

    public async expirePendingActions(now: Date): Promise<number> {
        const rows = await this.sql<readonly IdentifierRow[]>`
            update pending_actions
            set status = 'expired', resolved_at = ${now}, updated_at = ${now}
            where status = 'pending' and expires_at < ${now}
            returning id
        `;
        return rows.length;
    }

    public async releaseOrphanedReservations(
        cutoff: Date,
        limit: number,
    ): Promise<number> {
        const reservations = await this.sql<readonly ReservationRow[]>`
            select
                reservation.team_id,
                reservation.conversation_id,
                reservation.idempotency_key,
                reservation.credits_charged
            from ai_credit_transactions as reservation
            where reservation.type = 'reservation'
              and reservation.created_at < ${cutoff}
              and reservation.idempotency_key like 'reserve-%'
              and not exists (
                  select 1
                  from ai_credit_transactions as resolved
                  where resolved.team_id = reservation.team_id
                    and resolved.idempotency_key = replace(
                        reservation.idempotency_key,
                        'reserve-',
                        'resolve-'
                    )
              )
            order by reservation.created_at
            limit ${limit}
        `;
        let refunded = 0;

        for (const reservation of reservations) {
            const resolutionKey = reservation.idempotency_key.replace(
                /^reserve-/,
                "resolve-",
            );
            const credits = Math.max(1, reservation.credits_charged);

            refunded += await this.sql.begin(async (transaction) => {
                const inserted = await transaction<readonly IdentifierRow[]>`
                    insert into ai_credit_transactions (
                        id, team_id, user_id, conversation_id, idempotency_key,
                        type, model, input_tokens, output_tokens,
                        credits_charged, metadata, created_at
                    )
                    select
                        ${ulid()}, ${reservation.team_id}, null,
                        ${reservation.conversation_id}, ${resolutionKey},
                        'refund', 'system', 0, 0, ${credits},
                        ${transaction.json({ reason: "reservation_refund" } as JSONValue)},
                        now()
                    where exists (select 1 from teams where id = ${reservation.team_id})
                      and exists (
                          select 1
                          from ai_credit_balances
                          where team_id = ${reservation.team_id}
                      )
                    on conflict (team_id, idempotency_key) do nothing
                    returning id
                `;

                if (inserted.length === 0) {
                    return 0;
                }

                await transaction`
                    update ai_credit_balances
                    set
                        credits_remaining = credits_remaining + ${credits},
                        credits_used = greatest(credits_used - ${credits}, 0),
                        purchased_credits = case
                            when purchased_credits > 0
                             and purchased_credits = credits_remaining
                                then purchased_credits + ${credits}
                            else least(purchased_credits, credits_remaining + ${credits})
                        end,
                        updated_at = now()
                    where team_id = ${reservation.team_id}
                `;
                return 1;
            });
        }

        return refunded;
    }

    public async pruneQueueBatches(cutoffEpochSeconds: number): Promise<number> {
        const rows = await this.sql<readonly IdentifierRow[]>`
            delete from job_batches
            where (finished_at is not null and finished_at < ${cutoffEpochSeconds})
               or (cancelled_at is not null and cancelled_at < ${cutoffEpochSeconds})
            returning id
        `;
        return rows.length;
    }

    public async cleanupImports(
        staleCutoff: Date,
        terminalCutoff: Date,
        signal: AbortSignal,
    ): Promise<number> {
        const terminal = await this.sql<readonly IdentifierRow[]>`
            select id, team_id
            from imports
            where status in ('completed', 'failed')
              and updated_at < ${terminalCutoff}
        `;
        const abandoned = await this.sql<readonly IdentifierRow[]>`
            delete from imports
            where status not in ('completed', 'failed')
              and updated_at < ${staleCutoff}
            returning id, team_id
        `;
        let removed = abandoned.length;

        for (const { id, team_id: teamId } of [...terminal, ...abandoned]) {
            if (signal.aborted) {
                break;
            }

            if (teamId !== null && teamId !== undefined && await removePath(resolve(this.importsPath, teamId, `${id}.csv`))) {
                removed += terminal.some((row) => row.id === id) ? 1 : 0;
            }
        }

        return removed + (await this.removeOrphanedImportDirectories(staleCutoff, signal));
    }

    private async removeOrphanedImportDirectories(
        cutoff: Date,
        signal: AbortSignal,
    ): Promise<number> {
        let teamEntries;

        try {
            teamEntries = await readdir(this.importsPath, { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                return 0;
            }

            throw error;
        }

        let removed = 0;

        for (const teamEntry of teamEntries) {
            if (signal.aborted || !teamEntry.isDirectory()) {
                continue;
            }

            const teamPath = resolve(this.importsPath, teamEntry.name);
            const entries = await readdir(teamPath, { withFileTypes: true });
            for (const entry of entries) {
                if (signal.aborted || !entry.isFile() || !entry.name.endsWith(".csv")) continue;
                const path = resolve(teamPath, entry.name);
                let details;

                try {
                    details = await stat(path);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
                    throw error;
                }

                if (details.mtime >= cutoff) continue;
                const id = entry.name.slice(0, -4);

                const [existing] = await this.sql<readonly IdentifierRow[]>`
                    select id from imports where id = ${id} and team_id = ${teamEntry.name} limit 1
                `;

                if (existing === undefined && (await removePath(path))) removed += 1;
            }
        }

        return removed;
    }
}
