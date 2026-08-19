import { and, eq, isNotNull, isNull, or } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { teamInvitations, teams, teamUser, users } from "@/server/db/schema";
import { createUlid, type Ulid } from "@/server/ids";

export type TeamRole = "admin" | "member";

export class WorkspaceAuthorizationError extends Error {}
export class WorkspaceValidationError extends Error {}

export const workspaceSlug = (name: string): string =>
    name.normalize("NFKD").replace(/\p{Mark}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 255);

export const listWorkspaces = async (userId: Ulid) =>
    getDatabase().select({ id: teams.id, name: teams.name, slug: teams.slug, ownerUserId: teams.userId })
        .from(teams)
        .leftJoin(teamUser, and(eq(teamUser.teamId, teams.id), eq(teamUser.userId, userId)))
        .where(and(isNull(teams.scheduledDeletionAt), or(eq(teams.userId, userId), isNotNull(teamUser.id))));

export const createWorkspace = async (userId: Ulid, input: Readonly<{ name: string; useCase?: string; referralSource?: string }>): Promise<{ id: Ulid; slug: string }> => {
    const database = getDatabase();
    const name = input.name.trim();
    const baseSlug = workspaceSlug(name);
    if (name.length < 2 || baseSlug === "") throw new WorkspaceValidationError("Enter a workspace name.");

    let slug = baseSlug;
    const [collision] = await database.select({ id: teams.id }).from(teams).where(eq(teams.slug, slug)).limit(1);
    if (collision !== undefined) slug = `${baseSlug}-${createUlid().slice(-6).toLowerCase()}`;
    const id = createUlid();
    const now = new Date();
    await database.transaction(async (transaction) => {
        await transaction.insert(teams).values({ id, userId, name, slug, personalTeam: false, onboardingUseCase: input.useCase || null, onboardingReferralSource: input.referralSource || null, createdAt: now, updatedAt: now });
        await transaction.update(users).set({ currentTeamId: id, updatedAt: now }).where(eq(users.id, userId));
    });
    return { id, slug };
};

export const switchWorkspace = async (userId: Ulid, teamId: Ulid): Promise<string> => {
    const database = getDatabase();
    const [team] = await database.select({ slug: teams.slug, ownerUserId: teams.userId, memberId: teamUser.id })
        .from(teams)
        .leftJoin(teamUser, and(eq(teamUser.teamId, teams.id), eq(teamUser.userId, userId)))
        .where(and(eq(teams.id, teamId), isNull(teams.scheduledDeletionAt))).limit(1);
    if (team === undefined || (team.ownerUserId !== userId && team.memberId === null)) throw new WorkspaceAuthorizationError("You do not belong to that workspace.");
    await database.update(users).set({ currentTeamId: teamId, updatedAt: new Date() }).where(eq(users.id, userId));
    return team.slug;
};

const requireAdmin = async (userId: Ulid, teamId: Ulid) => {
    const [access] = await getDatabase().select({ ownerUserId: teams.userId, role: teamUser.role })
        .from(teams).leftJoin(teamUser, and(eq(teamUser.teamId, teamId), eq(teamUser.userId, userId)))
        .where(and(eq(teams.id, teamId), isNull(teams.scheduledDeletionAt))).limit(1);
    if (access === undefined || (access.ownerUserId !== userId && access.role !== "admin")) throw new WorkspaceAuthorizationError("Workspace administrator access is required.");
    return access;
};

export const listTeam = async (userId: Ulid, teamId: Ulid) => {
    const database = getDatabase();
    const [access] = await database.select({ ownerUserId: teams.userId, role: teamUser.role, memberId: teamUser.id })
        .from(teams).leftJoin(teamUser, and(eq(teamUser.teamId, teamId), eq(teamUser.userId, userId)))
        .where(and(eq(teams.id, teamId), isNull(teams.scheduledDeletionAt))).limit(1);
    if (access === undefined || (access.ownerUserId !== userId && access.memberId === null)) throw new WorkspaceAuthorizationError("You do not belong to that workspace.");
    const canManage = access.ownerUserId === userId || access.role === "admin";
    if (!canManage) return { canManage, members: [], invitations: [] };
    const members = await database.select({ id: users.id, name: users.name, email: users.email, role: teamUser.role })
        .from(teamUser).innerJoin(users, eq(users.id, teamUser.userId)).where(eq(teamUser.teamId, teamId));
    const invitations = await database.select().from(teamInvitations).where(eq(teamInvitations.teamId, teamId));
    return { canManage, members, invitations };
};

export const inviteMember = async (actorId: Ulid, teamId: Ulid, emailInput: string, role: TeamRole): Promise<Ulid> => {
    await requireAdmin(actorId, teamId);
    const email = emailInput.trim().toLowerCase();
    const now = new Date();
    const id = createUlid();
    await getDatabase().insert(teamInvitations).values({ id, teamId, email, role, expiresAt: new Date(now.getTime() + 7 * 86_400_000), createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [teamInvitations.teamId, teamInvitations.email], set: { role, expiresAt: new Date(now.getTime() + 7 * 86_400_000), updatedAt: now } });
    const [persisted] = await getDatabase().select({ id: teamInvitations.id }).from(teamInvitations).where(and(eq(teamInvitations.teamId, teamId), eq(teamInvitations.email, email))).limit(1);
    return persisted?.id ?? id;
};

export const getInvitation = async (userId: Ulid, invitationId: Ulid) => {
    const [invitation] = await getDatabase().select({ id: teamInvitations.id, email: teamInvitations.email, role: teamInvitations.role, expiresAt: teamInvitations.expiresAt, teamId: teams.id, teamName: teams.name, teamSlug: teams.slug, userEmail: users.email })
        .from(teamInvitations).innerJoin(teams, eq(teams.id, teamInvitations.teamId)).innerJoin(users, eq(users.id, userId))
        .where(and(eq(teamInvitations.id, invitationId), isNull(teams.scheduledDeletionAt))).limit(1);
    if (invitation === undefined || invitation.email.toLowerCase() !== invitation.userEmail.toLowerCase() || (invitation.expiresAt !== null && invitation.expiresAt <= new Date())) throw new WorkspaceAuthorizationError("This invitation is unavailable.");
    return invitation;
};

export const acceptInvitation = async (userId: Ulid, invitationId: Ulid): Promise<{ slug: string; teamName: string; ownerEmail: string }> => {
    const database = getDatabase();
    const invitation = await getInvitation(userId, invitationId);
    const role: TeamRole = invitation.role === "admin" ? "admin" : "member";
    const now = new Date();
    await database.transaction(async (transaction) => {
        await transaction.insert(teamUser).values({ teamId: invitation.teamId, userId, role, createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [teamUser.teamId, teamUser.userId], set: { role, updatedAt: now } });
        await transaction.delete(teamInvitations).where(eq(teamInvitations.id, invitationId));
        await transaction.update(users).set({ currentTeamId: invitation.teamId, updatedAt: now }).where(eq(users.id, userId));
    });
    const [owner] = await database.select({ email: users.email }).from(users).innerJoin(teams, eq(teams.userId, users.id)).where(eq(teams.id, invitation.teamId)).limit(1);
    return { slug: invitation.teamSlug, teamName: invitation.teamName, ownerEmail: owner?.email ?? invitation.userEmail };
};

export const changeMemberRole = async (actorId: Ulid, teamId: Ulid, memberId: Ulid, role: TeamRole): Promise<{ email: string; teamName: string } | undefined> => {
    await requireAdmin(actorId, teamId);
    await getDatabase().update(teamUser).set({ role, updatedAt: new Date() }).where(and(eq(teamUser.teamId, teamId), eq(teamUser.userId, memberId)));
    const [recipient] = await getDatabase().select({ email: users.email, teamName: teams.name }).from(users).innerJoin(teams, eq(teams.id, teamId)).where(eq(users.id, memberId)).limit(1);
    return recipient;
};

export const removeMember = async (actorId: Ulid, teamId: Ulid, memberId: Ulid): Promise<{ email: string; teamName: string } | undefined> => {
    const access = await requireAdmin(actorId, teamId);
    if (access.ownerUserId === memberId) throw new WorkspaceValidationError("The workspace owner cannot be removed.");
    const [recipient] = await getDatabase().select({ email: users.email, teamName: teams.name }).from(users).innerJoin(teams, eq(teams.id, teamId)).where(eq(users.id, memberId)).limit(1);
    await getDatabase().delete(teamUser).where(and(eq(teamUser.teamId, teamId), eq(teamUser.userId, memberId)));
    return recipient;
};

export const leaveWorkspace = async (userId: Ulid, teamId: Ulid): Promise<void> => {
    const database = getDatabase();
    const [team] = await database.select({ ownerUserId: teams.userId }).from(teams).where(eq(teams.id, teamId)).limit(1);
    if (team?.ownerUserId === userId) throw new WorkspaceValidationError("Transfer ownership before leaving this workspace.");
    await database.transaction(async (transaction) => {
        await transaction.delete(teamUser).where(and(eq(teamUser.teamId, teamId), eq(teamUser.userId, userId)));
        await transaction.update(users).set({ currentTeamId: null, updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.currentTeamId, teamId)));
    });
};
