import {
    hashSanctumTokenSecret,
    parseSanctumPlainTextToken,
    verifySanctumTokenSecret,
} from "@/server/auth/compatibility/sanctum";
import { resolveLegacySession } from "@/server/auth/compatibility/legacy-session";
import {
    apiAbilities,
    createRequestContext,
    type ApiAbility,
    type RequestContext,
} from "@/server/context/request-context";
import { ulidSchema, type Ulid } from "@/server/ids";

import type {
    AuthenticatedTeam,
    AuthenticatedUser,
    HttpAuthConfiguration,
    HttpAuthFailureReason,
    HttpAuthIdentityResult,
    HttpAuthIdentitySuccess,
    HttpAuthRejected,
    HttpAuthRepository,
    HttpAuthResult,
    HttpAuthSuccess,
    ResolveHttpAuthInput,
    ResolvedHttpCredential,
    ResolvedPersonalAccessToken,
} from "./types";

const failureStatuses: Readonly<
    Record<HttpAuthFailureReason, 401 | 403>
> = {
    credentials_missing: 401,
    token_invalid: 401,
    token_expired: 401,
    token_type_unsupported: 401,
    token_abilities_invalid: 401,
    session_invalid: 401,
    user_not_found: 401,
    email_unverified: 403,
    user_scheduled_for_deletion: 403,
    ability_denied: 403,
    team_not_found: 403,
    team_membership_required: 403,
};

type CredentialResolution =
    | Readonly<{ ok: true; credential: ResolvedHttpCredential }>
    | HttpAuthRejected;

type BearerToken =
    | Readonly<{ kind: "absent" }>
    | Readonly<{ kind: "invalid" }>
    | Readonly<{ kind: "present"; plainTextToken: string }>;

const reject = (reason: HttpAuthFailureReason): HttpAuthRejected =>
    Object.freeze({
        ok: false,
        failure: Object.freeze({ reason, status: failureStatuses[reason] }),
    });

const parseBearerToken = (authorization: string | null): BearerToken => {
    if (authorization === null || !/^\s*Bearer\b/iu.test(authorization)) {
        return { kind: "absent" };
    }

    const match = /^\s*Bearer[\t ]+([^\s,]+)\s*$/iu.exec(authorization);

    return match?.[1] === undefined
        ? { kind: "invalid" }
        : { kind: "present", plainTextToken: match[1] };
};

const findCookieValue = (
    cookieHeader: string | null,
    cookieName: string,
): string | undefined => {
    if (cookieHeader === null) {
        return undefined;
    }

    for (const cookie of cookieHeader.split(";")) {
        const separatorIndex = cookie.indexOf("=");

        if (separatorIndex === -1) {
            continue;
        }

        const name = cookie.slice(0, separatorIndex).trim();

        if (name === cookieName) {
            return cookie.slice(separatorIndex + 1).trim();
        }
    }

    return undefined;
};

const parseTokenAbilities = (
    encodedAbilities: string | null,
): readonly ApiAbility[] | undefined => {
    if (encodedAbilities === null) {
        return Object.freeze([]);
    }

    let decoded: unknown;

    try {
        decoded = JSON.parse(encodedAbilities);
    } catch {
        return undefined;
    }

    if (
        !Array.isArray(decoded) ||
        !decoded.every((ability): ability is string => typeof ability === "string")
    ) {
        return undefined;
    }

    if (decoded.includes("*")) {
        return Object.freeze([...apiAbilities]);
    }

    const grantedAbilities = new Set(decoded);

    return Object.freeze(
        apiAbilities.filter((ability) => grantedAbilities.has(ability)),
    );
};

export const apiAbilityForHttpMethod = (method: string): ApiAbility => {
    switch (method.toUpperCase()) {
        case "POST":
            return "create";
        case "PUT":
        case "PATCH":
            return "update";
        case "DELETE":
            return "delete";
        default:
            return "read";
    }
};

const safeTokenId = (tokenId: string): string | undefined =>
    /^[1-9][0-9]*$/u.test(tokenId) ? tokenId : undefined;

const resolvePersonalAccessToken = async (
    plainTextToken: string,
    repository: HttpAuthRepository,
    now: Date,
): Promise<CredentialResolution> => {
    let parsedToken: ReturnType<typeof parseSanctumPlainTextToken>;

    try {
        parsedToken = parseSanctumPlainTextToken(plainTextToken);
    } catch {
        return reject("token_invalid");
    }

    const tokenHash = hashSanctumTokenSecret(parsedToken.secret);
    const token =
        parsedToken.kind === "id"
            ? await repository.findPersonalAccessTokenById(parsedToken.tokenId)
            : await repository.findPersonalAccessTokenByHash(tokenHash);

    if (
        token === undefined ||
        (parsedToken.kind === "id" && token.id !== parsedToken.tokenId) ||
        !verifySanctumTokenSecret(parsedToken.secret, token.tokenHash)
    ) {
        return reject("token_invalid");
    }

    if (token.tokenableType !== "user") {
        return reject("token_type_unsupported");
    }

    if (token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime()) {
        return reject("token_expired");
    }

    const abilities = parseTokenAbilities(token.abilities);

    if (abilities === undefined) {
        return reject("token_abilities_invalid");
    }

    const userId = ulidSchema.safeParse(token.tokenableId);
    const teamId =
        token.teamId === null ? null : ulidSchema.safeParse(token.teamId);
    const tokenId = safeTokenId(token.id);

    if (
        !userId.success ||
        (teamId !== null && !teamId.success) ||
        tokenId === undefined
    ) {
        return reject("token_invalid");
    }

    const resolvedToken: ResolvedPersonalAccessToken = Object.freeze({
        tokenId,
        userId: userId.data,
        teamId: teamId?.data ?? null,
        abilities,
    });

    return Object.freeze({
        ok: true,
        credential: Object.freeze({
            kind: "personal_access_token",
            token: resolvedToken,
        }),
    });
};

const resolveSessionCredential = async (
    input: ResolveHttpAuthInput,
    repository: HttpAuthRepository,
    configuration: HttpAuthConfiguration,
    now: Date,
): Promise<CredentialResolution> => {
    const encryptedCookieValue = findCookieValue(
        input.request.headers.get("cookie"),
        configuration.sessionCookieName,
    );

    if (encryptedCookieValue === undefined) {
        return reject("credentials_missing");
    }

    const session = await resolveLegacySession(
        {
            cookieName: configuration.sessionCookieName,
            encryptedCookieValue,
            appKeys: configuration.appKeys,
            lifetimeMinutes: configuration.sessionLifetimeMinutes,
            now,
        },
        (sessionId) => repository.findSessionById(sessionId),
    );

    if (session === undefined) {
        return reject("session_invalid");
    }

    return Object.freeze({
        ok: true,
        credential: Object.freeze({
            kind: "session",
            sessionId: session.sessionId,
            userId: session.userId,
        }),
    });
};

const resolveCredential = async (
    input: ResolveHttpAuthInput,
    repository: HttpAuthRepository,
    configuration: HttpAuthConfiguration,
    now: Date,
): Promise<CredentialResolution> => {
    const bearerToken = parseBearerToken(
        input.request.headers.get("authorization"),
    );

    if (bearerToken.kind === "invalid") {
        return reject("token_invalid");
    }

    if (bearerToken.kind === "present") {
        return resolvePersonalAccessToken(
            bearerToken.plainTextToken,
            repository,
            now,
        );
    }

    return resolveSessionCredential(
        input,
        repository,
        configuration,
        now,
    );
};

const freezeRequestContext = (context: RequestContext): RequestContext => {
    if (context.credential.kind === "personal_access_token") {
        Object.freeze(context.credential.abilities);
    }

    Object.freeze(context.credential);

    return context;
};

const resolveRequestedTeamId = (
    input: ResolveHttpAuthInput,
    credential: ResolvedHttpCredential,
    currentTeamId: string | null,
): Ulid | undefined => {
    if (
        credential.kind === "personal_access_token" &&
        credential.token.teamId !== null
    ) {
        return credential.token.teamId;
    }

    const headerTeamId = ulidSchema.safeParse(
        input.request.headers.get("x-team-id"),
    );

    if (headerTeamId.success) {
        return headerTeamId.data;
    }

    const fallbackTeamId = ulidSchema.safeParse(currentTeamId);

    return fallbackTeamId.success ? fallbackTeamId.data : undefined;
};

const toSafeUser = (
    id: Ulid,
    name: string,
    email: string,
): AuthenticatedUser => Object.freeze({ id, name, email });

const toSafeTeam = (
    id: Ulid,
    name: string,
    slug: string,
    personalTeam: boolean,
): AuthenticatedTeam => Object.freeze({ id, name, slug, personalTeam });

export const resolveHttpAuth = async (
    input: ResolveHttpAuthInput,
    repository: HttpAuthRepository,
    configuration: HttpAuthConfiguration,
): Promise<HttpAuthResult> => {
    const identity = await resolveHttpIdentity(input, repository, configuration);

    if (!identity.ok) {
        return identity;
    }

    return authorizeHttpIdentity(input, identity, repository);
};

export const resolveHttpIdentity = async (
    input: ResolveHttpAuthInput,
    repository: HttpAuthRepository,
    configuration: HttpAuthConfiguration,
): Promise<HttpAuthIdentityResult> => {
    const credentialResolution = await resolveCredential(
        input,
        repository,
        configuration,
        input.now ?? new Date(),
    );

    if (!credentialResolution.ok) {
        return credentialResolution;
    }

    const { credential } = credentialResolution;
    const credentialUserId =
        credential.kind === "session"
            ? credential.userId
            : credential.token.userId;
    const user = await repository.findUserById(credentialUserId);
    const userId = ulidSchema.safeParse(user?.id);

    if (
        user === undefined ||
        !userId.success ||
        userId.data !== credentialUserId
    ) {
        return reject("user_not_found");
    }

    if (
        configuration.requireEmailVerification &&
        user.emailVerifiedAt === null
    ) {
        return reject("email_unverified");
    }

    if (user.scheduledDeletionAt !== null) {
        return reject("user_scheduled_for_deletion");
    }

    const result: HttpAuthIdentitySuccess = Object.freeze({
        ok: true,
        credential,
        userId: userId.data,
        currentTeamId: user.currentTeamId,
        user: toSafeUser(userId.data, user.name, user.email),
    });

    return result;
};

export const authorizeHttpIdentity = async (
    input: ResolveHttpAuthInput,
    identity: HttpAuthIdentitySuccess,
    repository: HttpAuthRepository,
): Promise<HttpAuthResult> => {
    const { credential } = identity;

    if (
        credential.kind === "personal_access_token" &&
        !credential.token.abilities.includes(
            apiAbilityForHttpMethod(input.request.method),
        )
    ) {
        return reject("ability_denied");
    }

    const requestedTeamId = resolveRequestedTeamId(
        input,
        credential,
        identity.currentTeamId,
    );

    if (requestedTeamId === undefined) {
        return reject("team_not_found");
    }

    const team = await repository.findTeamById(requestedTeamId);
    const teamId = ulidSchema.safeParse(team?.id);
    const ownerUserId = ulidSchema.safeParse(team?.ownerUserId);

    if (
        team === undefined ||
        !teamId.success ||
        teamId.data !== requestedTeamId ||
        !ownerUserId.success
    ) {
        return reject("team_not_found");
    }

    const belongsToTeam =
        ownerUserId.data === identity.userId ||
        (await repository.hasTeamMembership(identity.userId, teamId.data));

    if (!belongsToTeam) {
        return reject("team_membership_required");
    }

    const context = freezeRequestContext(
        createRequestContext({
            requestId: input.requestId,
            userId: identity.userId,
            teamId: teamId.data,
            credential:
                credential.kind === "session"
                    ? {
                          kind: "session",
                          sessionId: credential.sessionId,
                      }
                    : {
                          kind: "personal_access_token",
                          tokenId: credential.token.tokenId,
                          abilities: [...credential.token.abilities],
                      },
        }),
    );
    const result: HttpAuthSuccess = Object.freeze({
        ok: true,
        context,
        user: identity.user,
        team: toSafeTeam(teamId.data, team.name, team.slug, team.personalTeam),
    });

    return result;
};
