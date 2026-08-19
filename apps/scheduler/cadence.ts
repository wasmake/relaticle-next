import type { ScheduleCadence } from "../../packages/queue/src/index.js";

const minuteMilliseconds = 60_000;
const maximumCalendarSearchMinutes = 8 * 24 * 60;

type CalendarParts = Readonly<{
    weekday: number;
    hour: number;
    minute: number;
}>;

const weekdayIndexes = new Map([
    ["Sun", 0],
    ["Mon", 1],
    ["Tue", 2],
    ["Wed", 3],
    ["Thu", 4],
    ["Fri", 5],
    ["Sat", 6],
]);

const calendarParts = (
    date: Date,
    formatter: Intl.DateTimeFormat,
): CalendarParts => {
    const parts = new Map(
        formatter
            .formatToParts(date)
            .filter(({ type }) => type !== "literal")
            .map(({ type, value }) => [type, value]),
    );
    const weekday = weekdayIndexes.get(parts.get("weekday") ?? "");
    const hour = Number(parts.get("hour"));
    const minute = Number(parts.get("minute"));

    if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) {
        throw new Error("Unable to calculate calendar cadence.");
    }

    return { weekday, hour, minute };
};

type CalendarCadence = Exclude<ScheduleCadence, { readonly kind: "interval" }>;

const scheduledTime = (cadence: CalendarCadence): readonly [number, number] => {
    if (cadence.kind === "hourly") {
        return [-1, cadence.minute];
    }

    const [hour, minute] = cadence.time.split(":").map(Number);

    if (hour === undefined || minute === undefined) {
        throw new Error(`Invalid schedule time: ${cadence.time}.`);
    }

    return [hour, minute];
};

export const nextRunAt = (
    cadence: ScheduleCadence,
    after: Date,
    timeZone: string,
): Date => {
    if (cadence.kind === "interval") {
        return new Date(after.getTime() + cadence.milliseconds);
    }

    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    });
    const [scheduledHour, scheduledMinute] = scheduledTime(cadence);
    let timestamp =
        Math.floor(after.getTime() / minuteMilliseconds) * minuteMilliseconds +
        minuteMilliseconds;

    for (let offset = 0; offset < maximumCalendarSearchMinutes; offset += 1) {
        const candidate = new Date(timestamp);
        const parts = calendarParts(candidate, formatter);
        const hourMatches = scheduledHour === -1 || parts.hour === scheduledHour;
        const weekdayMatches =
            cadence.kind !== "weekly" || parts.weekday === cadence.weekday;

        if (
            hourMatches &&
            parts.minute === scheduledMinute &&
            weekdayMatches
        ) {
            return candidate;
        }

        timestamp += minuteMilliseconds;
    }

    throw new Error(`Unable to find the next ${cadence.kind} run.`);
};
