import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { nextRunAt } from "../../apps/scheduler/cadence";
import type {
    CleanupRepository,
    SchedulerSqlClient,
} from "../../apps/scheduler/database";
import { PostgresCleanupRepository } from "../../apps/scheduler/database";
import { parseSchedulerEnvironment } from "../../apps/scheduler/environment";
import {
    createCleanupHandlerRegistry,
    unimplementedScheduleHandlers,
} from "../../apps/scheduler/handlers";
import { RedisDistributedLock, type RedisLockClient } from "../../apps/scheduler/lock";
import {
    creditPeriodBounds,
    sitemapLinks,
    subscriberRecencyBucket,
    ProductionScheduleOperations,
    type ScheduleOperations,
} from "../../apps/scheduler/operations";
import { SchedulerRuntime } from "../../apps/scheduler/runtime";
import { scheduleContracts, type ScheduledJobContract } from "../../packages/queue/src/index";

class RecordingCleanupRepository implements CleanupRepository {
    public readonly calls: { method: string; values: unknown[] }[] = [];

    public async deleteExpiredInvitations(cutoff: Date): Promise<number> {
        this.calls.push({ method: "invitations", values: [cutoff] });
        return 1;
    }

    public async deleteOldActivity(cutoff: Date): Promise<number> {
        this.calls.push({ method: "activity", values: [cutoff] });
        return 1;
    }

    public async expirePendingActions(now: Date): Promise<number> {
        this.calls.push({ method: "pending", values: [now] });
        return 1;
    }

    public async releaseOrphanedReservations(
        cutoff: Date,
        limit: number,
    ): Promise<number> {
        this.calls.push({ method: "reservations", values: [cutoff, limit] });
        return 1;
    }

    public async pruneQueueBatches(cutoffEpochSeconds: number): Promise<number> {
        this.calls.push({ method: "batches", values: [cutoffEpochSeconds] });
        return 1;
    }

    public async cleanupImports(
        staleCutoff: Date,
        terminalCutoff: Date,
        signal: AbortSignal,
    ): Promise<number> {
        this.calls.push({
            method: "imports",
            values: [staleCutoff, terminalCutoff, signal],
        });
        return 1;
    }
}

class RecordingScheduleOperations implements ScheduleOperations {
    public readonly calls: { method: string; values: unknown[] }[] = [];

    public async resetCredits(now: Date): Promise<void> {
        this.calls.push({ method: "credits", values: [now] });
    }
    public async processTrials(now: Date, signal: AbortSignal): Promise<void> {
        this.calls.push({ method: "trials", values: [now, signal] });
    }
    public async updateDisposableDomains(signal: AbortSignal): Promise<void> {
        this.calls.push({ method: "disposable", values: [signal] });
    }
    public async syncSubscriberRecency(now: Date, signal: AbortSignal): Promise<void> {
        this.calls.push({ method: "recency", values: [now, signal] });
    }
    public async purgeScheduledDeletions(now: Date, signal: AbortSignal): Promise<void> {
        this.calls.push({ method: "purge", values: [now, signal] });
    }
    public async sendTaskDigests(now: Date, signal: AbortSignal): Promise<void> {
        this.calls.push({ method: "digests", values: [now, signal] });
    }
    public async runHealthChecks(now: Date): Promise<void> {
        this.calls.push({ method: "health", values: [now] });
    }
    public async queueHeartbeat(now: Date): Promise<void> {
        this.calls.push({ method: "queue-heartbeat", values: [now] });
    }
    public async scheduleHeartbeat(now: Date): Promise<void> {
        this.calls.push({ method: "schedule-heartbeat", values: [now] });
    }
}

const current = new Date("2026-08-19T12:00:00.000Z");

describe("scheduler cadence", () => {
    it("calculates interval and zoned calendar runs", () => {
        expect(
            nextRunAt(
                { kind: "interval", milliseconds: 300_000 },
                current,
                "UTC",
            ),
        ).toEqual(new Date("2026-08-19T12:05:00.000Z"));
        expect(
            nextRunAt(
                { kind: "daily", time: "09:30" },
                current,
                "America/New_York",
            ),
        ).toEqual(new Date("2026-08-19T13:30:00.000Z"));
        expect(
            nextRunAt(
                { kind: "weekly", weekday: 0, time: "00:00" },
                current,
                "UTC",
            ),
        ).toEqual(new Date("2026-08-23T00:00:00.000Z"));
    });

    it("skips a nonexistent wall-clock time during DST", () => {
        expect(
            nextRunAt(
                { kind: "daily", time: "02:30" },
                new Date("2026-03-08T06:59:00.000Z"),
                "America/New_York",
            ),
        ).toEqual(new Date("2026-03-09T06:30:00.000Z"));
    });
});

describe("Redis scheduler lock", () => {
    it("uses an expiring NX lock and owner-checked release", async () => {
        const set = vi.fn<RedisLockClient["set"]>().mockResolvedValue("OK");
        const evaluate = vi
            .fn<RedisLockClient["eval"]>()
            .mockResolvedValue(1);
        const lock = new RedisDistributedLock(
            { set, eval: evaluate },
            "test-lock",
        );

        const lease = await lock.acquire("one", 12_345);

        expect(set).toHaveBeenCalledWith(
            "test-lock:one",
            expect.any(String),
            "PX",
            12_345,
            "NX",
        );
        await expect(lease?.renew()).resolves.toBe(true);
        await lease?.release();
        await lease?.release();
        expect(evaluate).toHaveBeenCalledTimes(2);
        expect(evaluate).toHaveBeenLastCalledWith(
            expect.stringContaining('redis.call("get"'),
            1,
            "test-lock:one",
            set.mock.calls[0]?.[1],
        );
    });

    it("does not return a release function when another owner holds the lock", async () => {
        const lock = new RedisDistributedLock({
            set: vi.fn<RedisLockClient["set"]>().mockResolvedValue(null),
            eval: vi.fn<RedisLockClient["eval"]>(),
        });

        await expect(lock.acquire("held", 1_000)).resolves.toBeUndefined();
    });
});

describe("scheduler cleanup handlers", () => {
    it("registers the six safe handlers and calculates their cutoffs", async () => {
        const repository = new RecordingCleanupRepository();
        const operations = new RecordingScheduleOperations();
        const handlers = createCleanupHandlerRegistry(
            repository,
            operations,
            () => current,
        );
        const context = {
            arguments: [] as readonly string[],
            signal: new AbortController().signal,
            scheduledAt: current,
        };

        await handlers.get("invitations:cleanup")?.(context);
        await handlers.get("activitylog:clean")?.(context);
        await handlers.get("chat:expire-pending-actions")?.(context);
        await handlers.get("chat:release-orphaned-reservations")?.(context);
        await handlers.get("queue:prune-batches")?.({
            ...context,
            arguments: ["--hours=24"],
        });
        await handlers.get("import:cleanup")?.(context);

        expect([...handlers.keys()].slice(0, 6)).toEqual([
            "invitations:cleanup",
            "activitylog:clean",
            "chat:expire-pending-actions",
            "chat:release-orphaned-reservations",
            "queue:prune-batches",
            "import:cleanup",
        ]);
        expect(handlers.size).toBe(15);
        expect(repository.calls).toEqual([
            {
                method: "invitations",
                values: [new Date("2026-07-20T12:00:00.000Z")],
            },
            {
                method: "activity",
                values: [new Date("2025-08-19T12:00:00.000Z")],
            },
            { method: "pending", values: [current] },
            {
                method: "reservations",
                values: [new Date("2026-08-19T11:30:00.000Z"), 500],
            },
            { method: "batches", values: [1_787_054_400] },
            {
                method: "imports",
                values: [
                    new Date("2026-08-18T12:00:00.000Z"),
                    new Date("2026-08-19T10:00:00.000Z"),
                    context.signal,
                ],
            },
        ]);
    });

    it("dispatches every remaining contract to a concrete operation", async () => {
        const operations = new RecordingScheduleOperations();
        const handlers = createCleanupHandlerRegistry(
            new RecordingCleanupRepository(),
            operations,
            () => current,
        );
        const context = {
            arguments: [] as readonly string[],
            signal: new AbortController().signal,
            scheduledAt: current,
        };

        for (const key of [
            "chat:reset-credits",
            "billing:process-trials",
            "disposable:update",
            "subscribers:sync-recency-tags",
            "app:purge-scheduled-deletions",
            "notifications:send-task-digest",
            "health:check",
            "health:queue-check-heartbeat",
            "health:schedule-check-heartbeat",
        ]) {
            await handlers.get(key)?.(context);
        }

        expect(operations.calls.map(({ method }) => method)).toEqual([
            "credits",
            "trials",
            "disposable",
            "recency",
            "purge",
            "digests",
            "health",
            "queue-heartbeat",
            "schedule-heartbeat",
        ]);
        expect(operations.calls.every(({ values }) => values.includes(current) || values.includes(context.signal))).toBe(true);
    });

    it("reports no unimplemented schedules", () => {
        const handlers = createCleanupHandlerRegistry(
            new RecordingCleanupRepository(),
            new RecordingScheduleOperations(),
        );

        expect(
            unimplementedScheduleHandlers(
                scheduleContracts.map(({ jobKey }) => jobKey),
                handlers,
            ),
        ).toEqual([]);
    });
});

describe("scheduler operation policies", () => {
    it("computes subscriber recency buckets at exact boundaries", () => {
        expect(subscriberRecencyBucket(null, current)).toBeNull();
        expect(subscriberRecencyBucket(new Date("2026-08-12T12:00:00Z"), current)).toBe("active-7d");
        expect(subscriberRecencyBucket(new Date("2026-07-20T12:00:00Z"), current)).toBe("active-30d");
        expect(subscriberRecencyBucket(new Date("2026-07-01T12:00:00Z"), current)).toBeNull();
        expect(subscriberRecencyBucket(new Date("2026-06-01T12:00:00Z"), current)).toBe("dormant");
    });

    it("preserves month-end subscription anniversaries", () => {
        expect(
            creditPeriodBounds(
                new Date("2026-02-28T12:00:00Z"),
                new Date("2025-01-31T12:00:00Z"),
                null,
            ),
        ).toEqual({
            start: new Date("2026-02-28T12:00:00Z"),
            end: new Date("2026-03-31T12:00:00Z"),
        });
    });

    it("extracts only same-origin crawlable sitemap links", () => {
        expect(
            sitemapLinks(
                '<a href="/help">Help</a><a href="https://crm.test/docs?q=1#top">Docs</a><a href="https://other.test/no">No</a><a href="mailto:a@crm.test">Mail</a>',
                new URL("https://crm.test"),
            ),
        ).toEqual([
            "https://crm.test/help",
            "https://crm.test/docs",
        ]);
    });
});

describe("scheduler external file operations", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("removes terminal import files from the team-scoped CSV layout", async () => {
        const directory = await mkdtemp(join(tmpdir(), "scheduler-imports-"));
        const teamId = "01J00000000000000000000001";
        const jobId = "01J00000000000000000000002";
        const file = join(directory, teamId, `${jobId}.csv`);
        await mkdir(join(directory, teamId), { recursive: true });
        await writeFile(file, "name\nAda\n");
        let call = 0;
        const sql = (() => {
            call += 1;
            return Promise.resolve(call === 1 ? [{ id: jobId, team_id: teamId }] : []);
        }) as unknown as SchedulerSqlClient;
        const repository = new PostgresCleanupRepository(sql, directory);

        try {
            await expect(repository.cleanupImports(current, current, new AbortController().signal)).resolves.toBe(1);
            await expect(access(file)).rejects.toMatchObject({ code: "ENOENT" });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });

    it("preserves the disposable-domain file when an upstream list is suspiciously short", async () => {
        const directory = await mkdtemp(join(tmpdir(), "scheduler-domains-"));
        const domainsPath = join(directory, "domains.json");
        await writeFile(domainsPath, '["existing.test"]\n');
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>(async () =>
                new Response('["temporary.test"]', {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            ),
        );
        const operations = productionOperations({
            DISPOSABLE_DOMAINS_PATH: domainsPath,
        });

        try {
            await expect(
                operations.updateDisposableDomains(
                    new AbortController().signal,
                ),
            ).rejects.toThrow(/only 1 valid domains/);
            await expect(readFile(domainsPath, "utf8")).resolves.toBe(
                '["existing.test"]\n',
            );
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});

const productionOperations = (
    overrides: Readonly<Record<string, string>>,
): ProductionScheduleOperations => {
    const environment = parseSchedulerEnvironment({
        APP_URL: "https://crm.test",
        ...overrides,
    });
    const unusedSql = (() => {
        throw new Error("Unexpected SQL call.");
    }) as unknown as SchedulerSqlClient;
    const redis = {
        del: vi.fn(async () => 1),
    } as unknown as Redis;

    return new ProductionScheduleOperations(unusedSql, redis, environment);
};

describe("scheduler runtime", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("takes a cluster lock, runs on cadence, and releases the lock", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(current);
        const handler = vi.fn(async () => undefined);
        const release = vi.fn(async () => undefined);
        const acquire = vi.fn(async () => ({ renew: vi.fn(async () => true), release }));
        const job: ScheduledJobContract = {
            jobKey: "test:singleton",
            arguments: [],
            cadence: { kind: "interval", milliseconds: 60_000 },
            overlap: { policy: "forbid", lockTimeoutMilliseconds: 90_000 },
            executionScope: "cluster-singleton",
        };
        const runtime = new SchedulerRuntime({
            jobs: [job],
            timeZone: "UTC",
            handlers: new Map([[job.jobKey, handler]]),
            lock: { acquire },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        });

        runtime.start();
        await vi.advanceTimersByTimeAsync(60_000);

        expect(acquire).toHaveBeenCalledWith("test:singleton", 90_000);
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
                arguments: [],
                scheduledAt: new Date("2026-08-19T12:01:00.000Z"),
            }),
        );
        expect(release).toHaveBeenCalledOnce();
        await runtime.stop();
    });

    it("does not run a singleton when its cluster lock is held", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(current);
        const handler = vi.fn(async () => undefined);
        const contract = scheduleContracts.find(
            ({ jobKey }) => jobKey === "chat:release-orphaned-reservations",
        );

        if (contract === undefined) {
            throw new Error("Missing reservation schedule contract.");
        }

        const runtime = new SchedulerRuntime({
            jobs: [contract],
            timeZone: "UTC",
            handlers: new Map([[contract.jobKey, handler]]),
            lock: { acquire: vi.fn(async () => undefined) },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        });

        runtime.start();
        await vi.advanceTimersByTimeAsync(600_000);

        expect(handler).not.toHaveBeenCalled();
        await runtime.stop();
    });

    it("aborts operations that exceed their deadline", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(current);
        let operationSignal: AbortSignal | undefined;
        const job: ScheduledJobContract = {
            jobKey: "test:deadline",
            arguments: [],
            cadence: { kind: "interval", milliseconds: 60_000 },
            overlap: { policy: "allow" },
            executionScope: "every-instance",
        };
        const runtime = new SchedulerRuntime({
            jobs: [job],
            timeZone: "UTC",
            handlers: new Map([[job.jobKey, async ({ signal }) => {
                operationSignal = signal;
                await new Promise(() => undefined);
            }]]),
            lock: { acquire: vi.fn() },
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
            operationDeadlineMilliseconds: 1_000,
        });

        runtime.start();
        await vi.advanceTimersByTimeAsync(61_000);
        expect(operationSignal?.aborted).toBe(true);
        await runtime.stop();
    });
});
