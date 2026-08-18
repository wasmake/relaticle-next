import { z } from "zod";

import { ulidSchema, type Ulid } from "@/server/ids";

export const apiAbilities = ["read", "create", "update", "delete"] as const;

export type ApiAbility = (typeof apiAbilities)[number];

const credentialSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("session"),
        sessionId: z.string().min(1),
    }),
    z.object({
        kind: z.literal("personal_access_token"),
        tokenId: z.string().regex(/^[1-9][0-9]*$/u),
        abilities: z.array(z.enum(apiAbilities)),
    }),
    z.object({
        kind: z.literal("oauth"),
        tokenId: z.string().min(1),
        scopes: z.array(z.string().min(1)),
    }),
]);

const requestContextSchema = z.object({
    requestId: z.string().min(1),
    userId: ulidSchema,
    teamId: ulidSchema,
    credential: credentialSchema,
});

export type RequestCredential = z.infer<typeof credentialSchema>;

export type RequestContext = Readonly<{
    requestId: string;
    userId: Ulid;
    teamId: Ulid;
    credential: RequestCredential;
}>;

export const createRequestContext = (input: unknown): RequestContext =>
    Object.freeze(requestContextSchema.parse(input));

export const hasApiAbility = (
    context: RequestContext,
    ability: ApiAbility,
): boolean => {
    if (context.credential.kind !== "personal_access_token") {
        return true;
    }

    return context.credential.abilities.includes(ability);
};
