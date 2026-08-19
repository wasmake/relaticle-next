import type { ApiAbility, RequestContext } from "@/server/context/request-context";
import type { Ulid } from "@/server/ids";

export type PersonalAccessTokenView = Readonly<{
    id: string;
    name: string;
    abilities: readonly string[];
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
}>;

export type CreatePersonalAccessTokenInput = Readonly<{
    userId: Ulid;
    teamId: Ulid;
    name: string;
    tokenHash: string;
    abilities: readonly ApiAbility[] | readonly ["*"];
    expiresAt: Date | null;
    occurredAt: Date;
}>;

export type CreatedPersonalAccessToken = Readonly<{
    token: PersonalAccessTokenView;
    plainTextToken: string;
}>;

export type PersonalAccessTokenContext = Pick<
    RequestContext,
    "userId" | "teamId" | "credential"
>;
