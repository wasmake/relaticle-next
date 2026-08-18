import { char, timestamp } from "drizzle-orm/pg-core";

export type JsonValue =
    | boolean
    | number
    | string
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export const ulid = <const TName extends string>(name: TName) =>
    char(name, { length: 26 });

export const laravelTimestamps = () => ({
    createdAt: timestamp("created_at", { mode: "date" }),
    updatedAt: timestamp("updated_at", { mode: "date" }),
});
