import type { CleanupRepository } from "./database.js";
import type { ScheduleOperations } from "./operations.js";
import type {
    ScheduledJobContext,
    ScheduledJobHandler,
    ScheduledJobRegistry,
} from "./runtime.js";

const hourMilliseconds = 60 * 60_000;
const dayMilliseconds = 24 * hourMilliseconds;

const optionInteger = (
    jobArguments: readonly string[],
    name: string,
    fallback: number,
    minimum = 1,
): number => {
    const prefix = `--${name}=`;
    const argument = jobArguments.find((value) => value.startsWith(prefix));

    if (argument === undefined) {
        return fallback;
    }

    const value = Number(argument.slice(prefix.length));

    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`--${name} must be an integer of at least ${minimum}.`);
    }

    return value;
};

const cutoff = (now: Date, milliseconds: number): Date =>
    new Date(now.getTime() - milliseconds);

export const createCleanupHandlerRegistry = (
    repository: CleanupRepository,
    operations: ScheduleOperations,
    now: () => Date = () => new Date(),
): ScheduledJobRegistry => {
    const handlers = new Map<string, ScheduledJobHandler>();

    handlers.set("invitations:cleanup", async ({ arguments: jobArguments }) => {
        const days = optionInteger(jobArguments, "days", 30);
        await repository.deleteExpiredInvitations(cutoff(now(), days * dayMilliseconds));
    });
    handlers.set("activitylog:clean", async () => {
        await repository.deleteOldActivity(cutoff(now(), 365 * dayMilliseconds));
    });
    handlers.set("chat:expire-pending-actions", async () => {
        await repository.expirePendingActions(now());
    });
    handlers.set(
        "chat:release-orphaned-reservations",
        async ({ arguments: jobArguments }) => {
            const minutes = optionInteger(jobArguments, "age", 30, 5);
            await repository.releaseOrphanedReservations(
                cutoff(now(), minutes * 60_000),
                500,
            );
        },
    );
    handlers.set("queue:prune-batches", async ({ arguments: jobArguments }) => {
        const hours = optionInteger(jobArguments, "hours", 24);
        const cutoffSeconds = Math.floor(
            (now().getTime() - hours * hourMilliseconds) / 1_000,
        );
        await repository.pruneQueueBatches(cutoffSeconds);
    });
    handlers.set(
        "import:cleanup",
        async ({ arguments: jobArguments, signal }: ScheduledJobContext) => {
            const staleHours = optionInteger(jobArguments, "hours", 24);
            const completedHours = optionInteger(
                jobArguments,
                "completed-hours",
                2,
            );
            const current = now();
            await repository.cleanupImports(
                cutoff(current, staleHours * hourMilliseconds),
                cutoff(current, completedHours * hourMilliseconds),
                signal,
            );
        },
    );
    handlers.set("chat:reset-credits", async () => {
        await operations.resetCredits(now());
    });
    handlers.set("billing:process-trials", async ({ signal }) => {
        await operations.processTrials(now(), signal);
    });
    handlers.set("disposable:update", async ({ signal }) => {
        await operations.updateDisposableDomains(signal);
    });
    handlers.set("subscribers:sync-recency-tags", async ({ signal }) => {
        await operations.syncSubscriberRecency(now(), signal);
    });
    handlers.set("app:purge-scheduled-deletions", async ({ signal }) => {
        await operations.purgeScheduledDeletions(now(), signal);
    });
    handlers.set("notifications:send-task-digest", async ({ signal }) => {
        await operations.sendTaskDigests(now(), signal);
    });
    handlers.set("health:check", async () => {
        await operations.runHealthChecks(now());
    });
    handlers.set("health:queue-check-heartbeat", async () => {
        await operations.queueHeartbeat(now());
    });
    handlers.set("health:schedule-check-heartbeat", async () => {
        await operations.scheduleHeartbeat(now());
    });

    return handlers;
};

export const unimplementedScheduleHandlers = (
    jobKeys: readonly string[],
    handlers: ScheduledJobRegistry,
): readonly string[] => jobKeys.filter((jobKey) => !handlers.has(jobKey));
