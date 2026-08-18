import { monotonicFactory } from "ulidx";
import { z } from "zod";

export const ulidSchema = z
    .string()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i)
    .transform((value: string): string => value.toUpperCase());

export type Ulid = z.infer<typeof ulidSchema>;

const createMonotonicUlid = monotonicFactory();

export const createUlid = (): Ulid => ulidSchema.parse(createMonotonicUlid());
