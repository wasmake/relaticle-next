import type { EnvironmentSource } from "./queues.js";

export const minimumSafeIntervalMilliseconds = 60_000;
export const maximumSafeIntervalMilliseconds = 2_147_483_647;

export type ScheduleCadence =
    | {
          readonly kind: "interval";
          readonly milliseconds: number;
      }
    | {
          readonly kind: "hourly";
          readonly minute: number;
      }
    | {
          readonly kind: "daily";
          readonly time: string;
      }
    | {
          readonly kind: "weekly";
          readonly weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
          readonly time: string;
      };

export type OverlapContract =
    | {
          readonly policy: "allow";
      }
    | {
          readonly policy: "forbid";
          readonly lockTimeoutMilliseconds: number;
      };

export interface ScheduleCondition {
    readonly kind: "environment-boolean";
    readonly variable: string;
    readonly equals: boolean;
}

export interface ScheduledJobContract {
    readonly jobKey: string;
    readonly arguments: readonly string[];
    readonly cadence: ScheduleCadence;
    readonly overlap: OverlapContract;
    readonly executionScope: "every-instance" | "cluster-singleton";
    readonly condition?: ScheduleCondition;
}

const defaultOverlapLockMilliseconds = 24 * 60 * 60 * 1_000;
const allowOverlap = { policy: "allow" } as const;
const forbidOverlap = {
    policy: "forbid",
    lockTimeoutMilliseconds: defaultOverlapLockMilliseconds,
} as const;
const healthChecksEnabled = {
    kind: "environment-boolean",
    variable: "HEALTH_CHECKS_ENABLED",
    equals: true,
} as const;

const isValidTime = (time: string): boolean =>
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);

const validateCadence = (job: ScheduledJobContract): void => {
    switch (job.cadence.kind) {
        case "interval":
            if (
                !Number.isSafeInteger(job.cadence.milliseconds) ||
                job.cadence.milliseconds < minimumSafeIntervalMilliseconds ||
                job.cadence.milliseconds > maximumSafeIntervalMilliseconds
            ) {
                throw new Error(
                    `${job.jobKey} interval must be a safe integer between ${minimumSafeIntervalMilliseconds}ms and ${maximumSafeIntervalMilliseconds}ms.`,
                );
            }
            break;
        case "hourly":
            if (
                !Number.isSafeInteger(job.cadence.minute) ||
                job.cadence.minute < 0 ||
                job.cadence.minute > 59
            ) {
                throw new Error(
                    `${job.jobKey} hourly minute must be between 0 and 59.`,
                );
            }
            break;
        case "daily":
        case "weekly":
            if (!isValidTime(job.cadence.time)) {
                throw new Error(
                    `${job.jobKey} time must use 24-hour HH:mm format.`,
                );
            }
            break;
    }
};

export const validateScheduleContracts = <
    const Contracts extends readonly ScheduledJobContract[],
>(
    contracts: Contracts,
): Contracts => {
    const keys = new Set<string>();

    for (const contract of contracts) {
        if (contract.jobKey.trim() === "") {
            throw new Error("Scheduled job keys cannot be empty.");
        }

        if (keys.has(contract.jobKey)) {
            throw new Error(`Duplicate scheduled job key: ${contract.jobKey}.`);
        }

        keys.add(contract.jobKey);
        validateCadence(contract);

        if (
            contract.overlap.policy === "forbid" &&
            (!Number.isSafeInteger(contract.overlap.lockTimeoutMilliseconds) ||
                contract.overlap.lockTimeoutMilliseconds < 1)
        ) {
            throw new Error(
                `${contract.jobKey} overlap lock timeout must be a positive safe integer.`,
            );
        }

        if (contract.arguments.some((argument) => argument.trim() === "")) {
            throw new Error(
                `${contract.jobKey} arguments cannot contain empty values.`,
            );
        }
    }

    return contracts;
};

const contracts = [
    {
        jobKey: "import:cleanup",
        arguments: [],
        cadence: { kind: "hourly", minute: 0 },
        overlap: allowOverlap,
        executionScope: "every-instance",
    },
    {
        jobKey: "queue:prune-batches",
        arguments: ["--hours=24"],
        cadence: { kind: "daily", time: "00:00" },
        overlap: allowOverlap,
        executionScope: "every-instance",
    },
    {
        jobKey: "invitations:cleanup",
        arguments: [],
        cadence: { kind: "daily", time: "00:00" },
        overlap: allowOverlap,
        executionScope: "every-instance",
    },
    {
        jobKey: "activitylog:clean",
        arguments: ["--force"],
        cadence: { kind: "daily", time: "00:00" },
        overlap: allowOverlap,
        executionScope: "every-instance",
    },
    {
        jobKey: "chat:expire-pending-actions",
        arguments: [],
        cadence: { kind: "interval", milliseconds: 5 * 60_000 },
        overlap: allowOverlap,
        executionScope: "every-instance",
    },
    {
        jobKey: "chat:release-orphaned-reservations",
        arguments: [],
        cadence: { kind: "interval", milliseconds: 10 * 60_000 },
        overlap: forbidOverlap,
        executionScope: "cluster-singleton",
    },
    {
        jobKey: "chat:reset-credits",
        arguments: [],
        cadence: { kind: "hourly", minute: 0 },
        overlap: forbidOverlap,
        executionScope: "cluster-singleton",
    },
    {
        jobKey: "billing:process-trials",
        arguments: [],
        cadence: { kind: "daily", time: "00:15" },
        overlap: forbidOverlap,
        executionScope: "cluster-singleton",
    },
    {
        jobKey: "disposable:update",
        arguments: [],
        cadence: { kind: "weekly", weekday: 0, time: "00:00" },
        overlap: forbidOverlap,
        executionScope: "cluster-singleton",
    },
    {
        jobKey: "subscribers:sync-recency-tags",
        arguments: [],
        cadence: { kind: "daily", time: "02:00" },
        overlap: forbidOverlap,
        executionScope: "cluster-singleton",
    },
    {
        jobKey: "app:purge-scheduled-deletions",
        arguments: [],
        cadence: { kind: "daily", time: "00:00" },
        overlap: forbidOverlap,
        executionScope: "cluster-singleton",
    },
    {
        jobKey: "notifications:send-task-digest",
        arguments: [],
        cadence: { kind: "hourly", minute: 0 },
        overlap: forbidOverlap,
        executionScope: "cluster-singleton",
    },
    {
        jobKey: "health:check",
        arguments: [],
        cadence: { kind: "interval", milliseconds: 60_000 },
        overlap: allowOverlap,
        executionScope: "every-instance",
        condition: healthChecksEnabled,
    },
    {
        jobKey: "health:queue-check-heartbeat",
        arguments: [],
        cadence: { kind: "interval", milliseconds: 60_000 },
        overlap: allowOverlap,
        executionScope: "every-instance",
        condition: healthChecksEnabled,
    },
    {
        jobKey: "health:schedule-check-heartbeat",
        arguments: [],
        cadence: { kind: "interval", milliseconds: 60_000 },
        overlap: allowOverlap,
        executionScope: "every-instance",
        condition: healthChecksEnabled,
    },
] as const satisfies readonly ScheduledJobContract[];

export const scheduleContracts = validateScheduleContracts(contracts);

const parseEnvironmentBoolean = (
    variable: string,
    source: EnvironmentSource,
): boolean => {
    const value = source[variable]?.trim().toLowerCase();

    if (value === undefined || value === "") {
        return false;
    }

    if (value === "true" || value === "1") {
        return true;
    }

    if (value === "false" || value === "0") {
        return false;
    }

    throw new Error(`${variable} must be true, false, 1, or 0.`);
};

export const isScheduledJobEnabled = (
    job: ScheduledJobContract,
    source: EnvironmentSource,
): boolean => {
    if (job.condition === undefined) {
        return true;
    }

    return (
        parseEnvironmentBoolean(job.condition.variable, source) ===
        job.condition.equals
    );
};
