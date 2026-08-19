import type { ScheduledJobContract } from "../../packages/queue/src/index.js";
import { nextRunAt } from "./cadence.js";
import type { DistributedLease, DistributedLock } from "./lock.js";

export interface ScheduledJobContext {
    readonly arguments: readonly string[];
    readonly signal: AbortSignal;
    readonly scheduledAt: Date;
}

export type ScheduledJobHandler = (context: ScheduledJobContext) => Promise<void>;
export type ScheduledJobRegistry = ReadonlyMap<string, ScheduledJobHandler>;

export interface SchedulerLogger {
    info(message: string, details?: Readonly<Record<string, unknown>>): void;
    warn(message: string, details?: Readonly<Record<string, unknown>>): void;
    error(message: string, details?: Readonly<Record<string, unknown>>): void;
}

export interface SchedulerRuntimeOptions {
    readonly jobs: readonly ScheduledJobContract[];
    readonly timeZone: string;
    readonly handlers: ScheduledJobRegistry;
    readonly lock: DistributedLock;
    readonly logger?: SchedulerLogger;
    readonly now?: () => Date;
    readonly setTimer?: (callback: () => void, delay: number) => NodeJS.Timeout;
    readonly clearTimer?: (timer: NodeJS.Timeout) => void;
    readonly operationDeadlineMilliseconds?: number;
}

const consoleLogger: SchedulerLogger = console;
const defaultOperationDeadlineMilliseconds = 15 * 60_000;

export class SchedulerRuntime {
    private readonly timers = new Map<string, NodeJS.Timeout>();
    private readonly running = new Set<Promise<void>>();
    private readonly controller = new AbortController();
    private readonly logger: SchedulerLogger;
    private readonly now: () => Date;
    private readonly setTimer: NonNullable<SchedulerRuntimeOptions["setTimer"]>;
    private readonly clearTimer: NonNullable<SchedulerRuntimeOptions["clearTimer"]>;
    private started = false;
    private stopped = false;

    public constructor(private readonly options: SchedulerRuntimeOptions) {
        this.logger = options.logger ?? consoleLogger;
        this.now = options.now ?? (() => new Date());
        this.setTimer = options.setTimer ?? setTimeout;
        this.clearTimer = options.clearTimer ?? clearTimeout;
    }

    public start(): void {
        if (this.started) {
            throw new Error("Scheduler runtime has already been started.");
        }

        this.started = true;

        for (const job of this.options.jobs) {
            if (!this.options.handlers.has(job.jobKey)) {
                this.logger.warn("Scheduled job has no handler", { jobKey: job.jobKey });
                continue;
            }

            this.schedule(job, this.now());
        }
    }

    public async stop(): Promise<void> {
        if (this.stopped) {
            return;
        }

        this.stopped = true;
        this.controller.abort();

        for (const timer of this.timers.values()) {
            this.clearTimer(timer);
        }

        this.timers.clear();
        await Promise.allSettled([...this.running]);
    }

    private schedule(job: ScheduledJobContract, after: Date): void {
        if (this.stopped) {
            return;
        }

        const scheduledAt = nextRunAt(job.cadence, after, this.options.timeZone);
        const delay = Math.max(0, scheduledAt.getTime() - this.now().getTime());
        const timer = this.setTimer(() => {
            this.timers.delete(job.jobKey);
            this.schedule(job, scheduledAt);
            this.track(this.execute(job, scheduledAt));
        }, delay);

        this.timers.set(job.jobKey, timer);
    }

    private track(execution: Promise<void>): void {
        this.running.add(execution);
        void execution.finally(() => this.running.delete(execution));
    }

    private async execute(
        job: ScheduledJobContract,
        scheduledAt: Date,
    ): Promise<void> {
        const handler = this.options.handlers.get(job.jobKey);

        if (handler === undefined || this.stopped) {
            return;
        }

        let lease: DistributedLease | undefined;
        let renewal: NodeJS.Timeout | undefined;
        const operation = new AbortController();
        const abort = (): void => operation.abort(this.controller.signal.reason);
        this.controller.signal.addEventListener("abort", abort, { once: true });
        const deadline = setTimeout(() => operation.abort(new Error(`${job.jobKey} exceeded its operation deadline.`)), this.options.operationDeadlineMilliseconds ?? defaultOperationDeadlineMilliseconds);

        try {
            if (job.executionScope === "cluster-singleton") {
                const timeout =
                    job.overlap.policy === "forbid"
                        ? job.overlap.lockTimeoutMilliseconds
                        : 60_000;
                lease = await this.options.lock.acquire(job.jobKey, timeout);

                if (lease === undefined) {
                    this.logger.info("Scheduled job skipped because lock is held", {
                        jobKey: job.jobKey,
                    });
                    return;
                }
                renewal = setInterval(() => {
                    void lease?.renew().then((renewed) => {
                        if (!renewed) operation.abort(new Error(`${job.jobKey} scheduler lock was lost.`));
                    }).catch((error: unknown) => operation.abort(error));
                }, Math.max(1_000, Math.floor(timeout / 3)));
                renewal.unref();
            }

            this.logger.info("Scheduled job started", { jobKey: job.jobKey });
            await Promise.race([
                handler({
                    arguments: job.arguments,
                    signal: operation.signal,
                    scheduledAt,
                }),
                new Promise<never>((_resolve, reject) => {
                    operation.signal.addEventListener("abort", () => reject(operation.signal.reason), { once: true });
                }),
            ]);
            this.logger.info("Scheduled job completed", { jobKey: job.jobKey });
        } catch (error) {
            this.logger.error("Scheduled job failed", {
                jobKey: job.jobKey,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        } finally {
            clearTimeout(deadline);
            if (renewal !== undefined) clearInterval(renewal);
            this.controller.signal.removeEventListener("abort", abort);
            if (lease !== undefined) {
                try {
                    await lease.release();
                } catch (error) {
                    this.logger.error("Scheduled job lock release failed", {
                        jobKey: job.jobKey,
                        error: error instanceof Error ? error.message : "Unknown error",
                    });
                }
            }
        }
    }
}
