import { createHash, randomBytes } from "node:crypto";

import { and, eq, ne } from "drizzle-orm";

import { hashLaravelPassword, verifyLaravelPassword } from "@/server/auth/compatibility/password";
import { getDatabase } from "@/server/db/client";
import { passwordResetTokens, sessions, users, userSocialAccounts } from "@/server/db/schema";
import { createUlid, type Ulid } from "@/server/ids";
import type { SocialProfile, SocialProvider } from "@/server/auth/oauth";

const tokenHash = (token: string): string =>
    createHash("sha256").update(token).digest("hex");

export class AccountValidationError extends Error {}

export const registerAccount = async (input: Readonly<{
    name: string;
    email: string;
    password: string;
}>): Promise<{ id: Ulid; email: string }> => {
    const database = getDatabase();
    const email = input.email.trim().toLowerCase();
    const [existing] = await database
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

    if (existing !== undefined) {
        throw new AccountValidationError("An account already uses that email address.");
    }

    const id = createUlid();
    const now = new Date();
    await database.insert(users).values({
        id,
        name: input.name.trim(),
        email,
        password: await hashLaravelPassword(input.password),
        createdAt: now,
        updatedAt: now,
    });

    return { id, email };
};

export const resolveSocialAccount = async (provider: SocialProvider, profile: SocialProfile, linkingUserId?: Ulid): Promise<{ id: Ulid; email: string; created: boolean }> => {
    if (!profile.emailVerified) throw new AccountValidationError("The provider did not verify this email address.");
    const database = getDatabase();
    const [social] = await database.select({ userId: userSocialAccounts.userId }).from(userSocialAccounts).where(and(eq(userSocialAccounts.providerName, provider), eq(userSocialAccounts.providerId, profile.id))).limit(1);
    if (social !== undefined) {
        if (linkingUserId !== undefined && social.userId !== linkingUserId) throw new AccountValidationError("This provider account is already linked.");
        const [user] = await database.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, social.userId)).limit(1);
        if (user === undefined) throw new AccountValidationError("The linked account no longer exists.");
        if (user.emailVerifiedAt === null && user.email.toLowerCase() === profile.email.trim().toLowerCase()) {
            await database.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
        }
        return { ...user, created: false };
    }
    let userId = linkingUserId;
    let email = profile.email.trim().toLowerCase();
    const now = new Date();
    const [matching] = await database.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.email, email)).limit(1);
    if (userId === undefined) userId = matching?.id;
    if (userId !== undefined) {
        const [linkedUser] = await database.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
        if (linkedUser === undefined) throw new AccountValidationError("The account no longer exists.");
        email = linkedUser.email;
    } else {
        userId = createUlid();
        await database.insert(users).values({ id: userId, name: profile.name.trim().slice(0, 255), email, emailVerifiedAt: now, password: null, createdAt: now, updatedAt: now });
    }
    if (linkingUserId === undefined && matching?.emailVerifiedAt === null) {
        await database.update(users).set({ emailVerifiedAt: now, updatedAt: now }).where(eq(users.id, userId));
    }
    const created = matching === undefined && linkingUserId === undefined;
    await database.insert(userSocialAccounts).values({ id: createUlid(), userId, providerName: provider, providerId: profile.id, createdAt: now, updatedAt: now });
    return { id: userId, email, created };
};

export const accountRequiresTwoFactor = async (userId: Ulid): Promise<boolean> => {
    const [user] = await getDatabase().select({ confirmedAt: users.twoFactorConfirmedAt }).from(users).where(eq(users.id, userId)).limit(1);
    return user?.confirmedAt !== null && user?.confirmedAt !== undefined;
};

export const scheduleAccountDeletion = async (userId: Ulid, cancel: boolean): Promise<{ id: Ulid; email: string; scheduledAt: Date | null }> => {
    const scheduledAt = cancel ? null : new Date(Date.now() + 30 * 86_400_000);
    const [user] = await getDatabase().update(users).set({ scheduledDeletionAt: scheduledAt, updatedAt: new Date() }).where(eq(users.id, userId)).returning({ id: users.id, email: users.email });
    if (user === undefined) throw new AccountValidationError("The account no longer exists.");
    if (!cancel) await getDatabase().delete(sessions).where(eq(sessions.userId, userId));
    return { id: user.id, email: user.email, scheduledAt };
};

export const requestPasswordReset = async (emailInput: string): Promise<string | undefined> => {
    const database = getDatabase();
    const email = emailInput.trim().toLowerCase();
    const [user] = await database.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);

    if (user === undefined) {
        return undefined;
    }

    const token = randomBytes(32).toString("hex");
    await database
        .insert(passwordResetTokens)
        .values({ email, token: tokenHash(token), createdAt: new Date() })
        .onConflictDoUpdate({
            target: passwordResetTokens.email,
            set: { token: tokenHash(token), createdAt: new Date() },
        });

    return token;
};

export const resetPassword = async (input: Readonly<{
    email: string;
    token: string;
    password: string;
    now?: Date;
}>): Promise<boolean> => {
    const database = getDatabase();
    const email = input.email.trim().toLowerCase();
    const now = input.now ?? new Date();
    const [reset] = await database
        .select()
        .from(passwordResetTokens)
        .where(and(eq(passwordResetTokens.email, email), eq(passwordResetTokens.token, tokenHash(input.token))))
        .limit(1);

    if (reset?.createdAt === null || reset === undefined || now.getTime() - reset.createdAt.getTime() > 60 * 60 * 1_000) {
        return false;
    }

    const [user] = await database.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (user === undefined) {
        return false;
    }

    await database.transaction(async (transaction) => {
        await transaction.update(users).set({ password: await hashLaravelPassword(input.password), updatedAt: now }).where(eq(users.id, user.id));
        await transaction.delete(passwordResetTokens).where(eq(passwordResetTokens.email, email));
        await transaction.delete(sessions).where(eq(sessions.userId, user.id));
    });

    return true;
};

export const updateProfile = async (userId: Ulid, input: Readonly<{ name: string; email: string }>): Promise<void> => {
    const database = getDatabase();
    const email = input.email.trim().toLowerCase();
    const [duplicate] = await database.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, userId))).limit(1);
    if (duplicate !== undefined) {
        throw new AccountValidationError("An account already uses that email address.");
    }

    const [current] = await database.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    await database.update(users).set({
        name: input.name.trim(),
        email,
        emailVerifiedAt: current?.email === email ? undefined : null,
        updatedAt: new Date(),
    }).where(eq(users.id, userId));
};

export const profilePhotoPath = async (userId: Ulid): Promise<string | null> => {
    const [user] = await getDatabase().select({ path: users.profilePhotoPath }).from(users).where(eq(users.id, userId)).limit(1);
    return user?.path ?? null;
};

export const updateProfilePhotoPath = async (userId: Ulid, path: string | null): Promise<void> => {
    await getDatabase().update(users).set({ profilePhotoPath: path, updatedAt: new Date() }).where(eq(users.id, userId));
};

export const updatePassword = async (userId: Ulid, currentPassword: string, password: string): Promise<boolean> => {
    const database = getDatabase();
    const [user] = await database.select({ password: users.password }).from(users).where(eq(users.id, userId)).limit(1);
    if (user?.password === null || user === undefined || !(await verifyLaravelPassword(currentPassword, user.password))) {
        return false;
    }

    await database.transaction(async (transaction) => {
        await transaction.update(users).set({ password: await hashLaravelPassword(password), updatedAt: new Date() }).where(eq(users.id, userId));
        await transaction.delete(sessions).where(eq(sessions.userId, userId));
    });
    return true;
};

export const listSessions = async (userId: Ulid) =>
    getDatabase().select({ id: sessions.id, ipAddress: sessions.ipAddress, userAgent: sessions.userAgent, lastActivity: sessions.lastActivity }).from(sessions).where(eq(sessions.userId, userId));

export const revokeSession = async (userId: Ulid, sessionId: string): Promise<void> => {
    await getDatabase().delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.id, sessionId)));
};
