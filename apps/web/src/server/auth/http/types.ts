import type { LaravelAppKeyInput } from "@/server/auth/compatibility/laravel-encrypter";
import type { LegacySessionRecord } from "@/server/auth/compatibility/legacy-session";
import type { ApiAbility, RequestContext } from "@/server/context/request-context";
import type { Ulid } from "@/server/ids";

export type PersonalAccessTokenRecord = Readonly<{
    id: string;
    tokenableType: string;
    tokenableId: string;
    teamId: string | null;
    tokenHash: string;
    abilities: string | null;
    expiresAt: Date | null;
}>;

export type HttpAuthUserRecord = Readonly<{
    id: string;
    name: string;
    email: string;
    emailVerifiedAt: Date | null;
    currentTeamId: string | null;
    scheduledDeletionAt: Date | null;
}>;

export type HttpAuthTeamRecord = Readonly<{
    id: string;
    ownerUserId: string;
    name: string;
    slug: string;
    personalTeam: boolean;
}>;

export interface HttpAuthRepository {
    findPersonalAccessTokenById(
        tokenId: string,
    ): Promise<PersonalAccessTokenRecord | undefined>;
    findPersonalAccessTokenByHash(
        tokenHash: string,
    ): Promise<PersonalAccessTokenRecord | undefined>;
    findSessionById(sessionId: string): Promise<LegacySessionRecord | undefined>;
    findUserById(userId: Ulid): Promise<HttpAuthUserRecord | undefined>;
    findTeamById(teamId: Ulid): Promise<HttpAuthTeamRecord | undefined>;
    hasTeamMembership(userId: Ulid, teamId: Ulid): Promise<boolean>;
}

export type HttpAuthConfiguration = Readonly<{
    appKeys: readonly LaravelAppKeyInput[];
    sessionCookieName: string;
    sessionLifetimeMinutes: number;
    requireEmailVerification: boolean;
}>;

export type HttpAuthRequest = Readonly<{
    method: string;
    headers: Pick<Headers, "get">;
}>;

export type ResolveHttpAuthInput = Readonly<{
    request: HttpAuthRequest;
    requestId: string;
    now?: Date;
}>;

export type AuthenticatedUser = Readonly<{
    id: Ulid;
    name: string;
    email: string;
}>;

export type AuthenticatedTeam = Readonly<{
    id: Ulid;
    name: string;
    slug: string;
    personalTeam: boolean;
}>;

export type HttpAuthFailureReason =
    | "credentials_missing"
    | "token_invalid"
    | "token_expired"
    | "token_type_unsupported"
    | "token_abilities_invalid"
    | "session_invalid"
    | "user_not_found"
    | "email_unverified"
    | "user_scheduled_for_deletion"
    | "ability_denied"
    | "team_not_found"
    | "team_membership_required";

export type HttpAuthFailure = Readonly<{
    reason: HttpAuthFailureReason;
    status: 401 | 403;
}>;

export type HttpAuthSuccess = Readonly<{
    ok: true;
    context: RequestContext;
    user: AuthenticatedUser;
    team: AuthenticatedTeam;
}>;

export type HttpAuthRejected = Readonly<{
    ok: false;
    failure: HttpAuthFailure;
}>;

export type HttpAuthResult = HttpAuthSuccess | HttpAuthRejected;

export type HttpAuthIdentitySuccess = Readonly<{
    ok: true;
    credential: ResolvedHttpCredential;
    userId: Ulid;
    currentTeamId: string | null;
    user: AuthenticatedUser;
}>;

export type HttpAuthIdentityResult = HttpAuthIdentitySuccess | HttpAuthRejected;

export type ResolvedPersonalAccessToken = Readonly<{
    tokenId: string;
    userId: Ulid;
    teamId: Ulid | null;
    abilities: readonly ApiAbility[];
}>;

export type ResolvedHttpCredential =
    | Readonly<{
          kind: "session";
          sessionId: string;
          userId: Ulid;
      }>
    | Readonly<{
          kind: "personal_access_token";
          token: ResolvedPersonalAccessToken;
      }>;
