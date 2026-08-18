import {
    isScheduledJobEnabled,
    scheduleContracts,
    type EnvironmentSource,
    type ScheduledJobContract,
} from "../../packages/queue/src/index";

export interface SchedulerProcessContract {
    readonly timeZone: string;
    readonly jobs: readonly ScheduledJobContract[];
}

const resolveTimeZone = (source: EnvironmentSource): string => {
    const timeZone = source.APP_TIMEZONE?.trim() || "UTC";

    try {
        new Intl.DateTimeFormat("en", { timeZone }).format();
    } catch {
        throw new Error(
            `APP_TIMEZONE is not a valid IANA time zone: ${timeZone}.`,
        );
    }

    return timeZone;
};

export const getSchedulerProcessContract = (
    source: EnvironmentSource = process.env,
): SchedulerProcessContract => ({
    timeZone: resolveTimeZone(source),
    jobs: scheduleContracts.filter((job) => isScheduledJobEnabled(job, source)),
});
