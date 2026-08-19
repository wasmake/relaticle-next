import { describe, expect, it } from "vitest";

import { getSchedulerProcessContract } from "../../apps/scheduler/config";
import { getWorkerProcessContracts } from "../../apps/worker/config";
import {
    queueContracts,
    scheduleContracts,
    validateQueueContracts,
    validateScheduleContracts,
    type ScheduledJobContract,
} from "../../packages/queue/src/index";

describe("queue worker contracts", () => {
    it("preserves the production queue policies", () => {
        expect(getWorkerProcessContracts({})).toEqual([
            {
                name: "default",
                workerTimeoutMilliseconds: 60_000,
                defaultMaxAttempts: 1,
                waitThresholdMilliseconds: 60_000,
                concurrency: { minimum: 3, maximum: 30 },
            },
            {
                name: "imports",
                workerTimeoutMilliseconds: 300_000,
                defaultMaxAttempts: 2,
                waitThresholdMilliseconds: 120_000,
                concurrency: { minimum: 3, maximum: 15 },
            },
            {
                name: "chat",
                workerTimeoutMilliseconds: 130_000,
                defaultMaxAttempts: 1,
                waitThresholdMilliseconds: 30_000,
                concurrency: { minimum: 1, maximum: 3 },
            },
        ]);
    });

    it("resolves and validates the existing chat scaling overrides", () => {
        const contracts = getWorkerProcessContracts({
            CHAT_WORKER_MIN: "2",
            CHAT_WORKER_MAX: "6",
        });

        expect(
            contracts.find(({ name }) => name === "chat")?.concurrency,
        ).toEqual({ minimum: 2, maximum: 6 });
        expect(() =>
            getWorkerProcessContracts({ CHAT_WORKER_MIN: "many" }),
        ).toThrow(/CHAT_WORKER_MIN/);
        expect(() =>
            getWorkerProcessContracts({
                CHAT_WORKER_MIN: "4",
                CHAT_WORKER_MAX: "3",
            }),
        ).toThrow(/minimum concurrency cannot exceed maximum/);
    });

    it("rejects duplicate queue definitions", () => {
        const first = queueContracts[0];
        const second = queueContracts[1];

        expect(() =>
            validateQueueContracts([first, { ...second, name: first.name }]),
        ).toThrow(/Duplicate queue name: default/);
    });
});

describe("scheduler contracts", () => {
    it("preserves every schedule from the Laravel application", () => {
        expect(
            scheduleContracts.map(
                ({ jobKey, arguments: jobArguments, cadence }) => ({
                    jobKey,
                    arguments: jobArguments,
                    cadence,
                }),
            ),
        ).toEqual([
            {
                jobKey: "import:cleanup",
                arguments: [],
                cadence: { kind: "hourly", minute: 0 },
            },
            {
                jobKey: "queue:prune-batches",
                arguments: ["--hours=24"],
                cadence: { kind: "daily", time: "00:00" },
            },
            {
                jobKey: "invitations:cleanup",
                arguments: [],
                cadence: { kind: "daily", time: "00:00" },
            },
            {
                jobKey: "activitylog:clean",
                arguments: ["--force"],
                cadence: { kind: "daily", time: "00:00" },
            },
            {
                jobKey: "chat:expire-pending-actions",
                arguments: [],
                cadence: { kind: "interval", milliseconds: 300_000 },
            },
            {
                jobKey: "chat:release-orphaned-reservations",
                arguments: [],
                cadence: { kind: "interval", milliseconds: 600_000 },
            },
            {
                jobKey: "chat:reset-credits",
                arguments: [],
                cadence: { kind: "hourly", minute: 0 },
            },
            {
                jobKey: "billing:process-trials",
                arguments: [],
                cadence: { kind: "daily", time: "00:15" },
            },
            {
                jobKey: "disposable:update",
                arguments: [],
                cadence: { kind: "weekly", weekday: 0, time: "00:00" },
            },
            {
                jobKey: "subscribers:sync-recency-tags",
                arguments: [],
                cadence: { kind: "daily", time: "02:00" },
            },
            {
                jobKey: "app:purge-scheduled-deletions",
                arguments: [],
                cadence: { kind: "daily", time: "00:00" },
            },
            {
                jobKey: "notifications:send-task-digest",
                arguments: [],
                cadence: { kind: "hourly", minute: 0 },
            },
            {
                jobKey: "health:check",
                arguments: [],
                cadence: { kind: "interval", milliseconds: 60_000 },
            },
            {
                jobKey: "health:queue-check-heartbeat",
                arguments: [],
                cadence: { kind: "interval", milliseconds: 60_000 },
            },
            {
                jobKey: "health:schedule-check-heartbeat",
                arguments: [],
                cadence: { kind: "interval", milliseconds: 60_000 },
            },
        ]);

        expect(
            scheduleContracts
                .filter(
                    ({ executionScope }) =>
                        executionScope === "cluster-singleton",
                )
                .map(({ jobKey, overlap }) => ({ jobKey, overlap })),
        ).toEqual([
            {
                jobKey: "chat:release-orphaned-reservations",
                overlap: {
                    policy: "forbid",
                    lockTimeoutMilliseconds: 86_400_000,
                },
            },
            {
                jobKey: "chat:reset-credits",
                overlap: {
                    policy: "forbid",
                    lockTimeoutMilliseconds: 86_400_000,
                },
            },
            {
                jobKey: "billing:process-trials",
                overlap: {
                    policy: "forbid",
                    lockTimeoutMilliseconds: 86_400_000,
                },
            },
            {
                jobKey: "disposable:update",
                overlap: {
                    policy: "forbid",
                    lockTimeoutMilliseconds: 86_400_000,
                },
            },
            {
                jobKey: "subscribers:sync-recency-tags",
                overlap: {
                    policy: "forbid",
                    lockTimeoutMilliseconds: 86_400_000,
                },
            },
            {
                jobKey: "app:purge-scheduled-deletions",
                overlap: {
                    policy: "forbid",
                    lockTimeoutMilliseconds: 86_400_000,
                },
            },
            {
                jobKey: "notifications:send-task-digest",
                overlap: {
                    policy: "forbid",
                    lockTimeoutMilliseconds: 86_400_000,
                },
            },
        ]);
    });

    it("applies the health gate and application time zone", () => {
        expect(getSchedulerProcessContract({}).jobs).toHaveLength(12);

        const enabled = getSchedulerProcessContract({
            APP_TIMEZONE: "America/New_York",
            HEALTH_CHECKS_ENABLED: "true",
        });

        expect(enabled.timeZone).toBe("America/New_York");
        expect(enabled.jobs).toHaveLength(15);
        expect(enabled.jobs.slice(-3).map(({ jobKey }) => jobKey)).toEqual([
            "health:check",
            "health:queue-check-heartbeat",
            "health:schedule-check-heartbeat",
        ]);
        expect(() =>
            getSchedulerProcessContract({ HEALTH_CHECKS_ENABLED: "enabled" }),
        ).toThrow(/HEALTH_CHECKS_ENABLED/);
        expect(() =>
            getSchedulerProcessContract({ APP_TIMEZONE: "Not\/A_Time_Zone" }),
        ).toThrow(/APP_TIMEZONE/);
    });

    it("rejects duplicate scheduled job keys", () => {
        const first = scheduleContracts[0];
        const second = scheduleContracts[1];

        expect(() =>
            validateScheduleContracts([
                first,
                { ...second, jobKey: first.jobKey },
            ]),
        ).toThrow(/Duplicate scheduled job key: import:cleanup/);
    });

    it.each([0, 59_999, 1.5, 2_147_483_648, Number.POSITIVE_INFINITY])(
        "rejects the unsafe interval %s",
        (milliseconds) => {
            const contract: ScheduledJobContract = {
                ...scheduleContracts[0],
                cadence: { kind: "interval", milliseconds },
            };

            expect(() => validateScheduleContracts([contract])).toThrow(
                /interval must be a safe integer between 60000ms and 2147483647ms/,
            );
        },
    );
});
