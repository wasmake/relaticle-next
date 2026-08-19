import { and, desc, eq, notInArray, sql } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { aiCreditBalances, aiCreditTransactions, subscriptionItems, subscriptions, teams, teamUser } from "@/server/db/schema";
import { createUlid, type Ulid } from "@/server/ids";

import type { BillingSynchronizationRepository, StripeSubscription } from "./service";

type Database = ReturnType<typeof getDatabase>;

const dateFromUnix = (value: number | null | undefined): Date | null =>
    value === undefined || value === null ? null : new Date(value * 1000);
const objectId = (value: string | Readonly<{ id: string }>): string => typeof value === "string" ? value : value.id;

export class DrizzleBillingRepository implements BillingSynchronizationRepository {
    public constructor(private readonly database: Database = getDatabase()) {}

    public async findTeamIdByCustomer(customerId: string): Promise<Ulid | undefined> {
        const [team] = await this.database.select({ id: teams.id }).from(teams).where(eq(teams.stripeId, customerId)).limit(1);
        return team?.id;
    }

    public async canManage(teamId: Ulid, userId: Ulid): Promise<boolean> {
        const [team] = await this.database.select({ ownerId: teams.userId }).from(teams).where(eq(teams.id, teamId)).limit(1);
        if (team?.ownerId === userId) return true;
        const [membership] = await this.database.select({ role: teamUser.role }).from(teamUser)
            .where(and(eq(teamUser.teamId, teamId), eq(teamUser.userId, userId))).limit(1);
        return membership?.role === "admin";
    }

    public async findWorkspace(teamId: Ulid) {
        const [workspace] = await this.database.select({
            id: teams.id, name: teams.name, slug: teams.slug, plan: teams.plan, stripeId: teams.stripeId,
            pmType: teams.pmType, pmLastFour: teams.pmLastFour, trialEndsAt: teams.trialEndsAt,
            proTrialUsedAt: teams.proTrialUsedAt,
        }).from(teams).where(eq(teams.id, teamId)).limit(1);
        return workspace;
    }

    public async setCustomer(teamId: Ulid, customerId: string): Promise<void> {
        await this.database.update(teams).set({ stripeId: customerId, updatedAt: new Date() }).where(eq(teams.id, teamId));
    }

    public async startTrial(teamId: Ulid, days: number): Promise<boolean> {
        const now = new Date();
        const trialEndsAt = new Date(now.getTime() + days * 86_400_000);
        const updated = await this.database.update(teams).set({ plan: "pro", trialEndsAt, proTrialUsedAt: now, updatedAt: now })
            .where(and(eq(teams.id, teamId), sql`${teams.proTrialUsedAt} is null`)).returning({ id: teams.id });
        return updated.length === 1;
    }

    public async billingOverview(teamId: Ulid) {
        const [subscription] = await this.database.select({
            status: subscriptions.stripeStatus, price: subscriptions.stripePrice,
            trialEndsAt: subscriptions.trialEndsAt, endsAt: subscriptions.endsAt,
        }).from(subscriptions).where(and(eq(subscriptions.teamId, teamId), eq(subscriptions.type, "default")))
            .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id)).limit(1);
        const [credits] = await this.database.select({
            remaining: aiCreditBalances.creditsRemaining, purchased: aiCreditBalances.purchasedCredits,
        }).from(aiCreditBalances).where(eq(aiCreditBalances.teamId, teamId)).limit(1);
        return { subscription: subscription ?? null, credits: credits ?? { remaining: 0, purchased: 0 } };
    }

    public async synchronizeSubscription(teamId: Ulid, subscription: StripeSubscription, event: Readonly<{ id: string; createdAt: Date }>): Promise<boolean> {
        const now = new Date();
        const firstItem = subscription.items.data[0];
        return this.database.transaction(async (transaction) => {
            const [record] = await transaction.insert(subscriptions).values({
                teamId, type: "default", stripeId: subscription.id, stripeStatus: subscription.status,
                stripePrice: firstItem?.price.id ?? null, quantity: firstItem?.quantity ?? null,
                trialEndsAt: dateFromUnix(subscription.trial_end), endsAt: dateFromUnix(subscription.cancel_at ?? subscription.canceled_at),
                stripeEventCreatedAt: event.createdAt, stripeEventId: event.id,
                createdAt: now, updatedAt: now,
            }).onConflictDoUpdate({ target: subscriptions.stripeId, set: {
                teamId, stripeStatus: subscription.status, stripePrice: firstItem?.price.id ?? null,
                quantity: firstItem?.quantity ?? null, trialEndsAt: dateFromUnix(subscription.trial_end),
                endsAt: dateFromUnix(subscription.cancel_at ?? subscription.canceled_at), updatedAt: now,
                stripeEventCreatedAt: event.createdAt, stripeEventId: event.id,
            }, setWhere: sql`${subscriptions.stripeEventCreatedAt} is null or ${subscriptions.stripeEventCreatedAt} < ${event.createdAt} or (${subscriptions.stripeEventCreatedAt} = ${event.createdAt} and coalesce(${subscriptions.stripeEventId}, '') < ${event.id})` }).returning({ id: subscriptions.id });
            if (record === undefined) return false;

            const incomingItemIds = subscription.items.data.map((item) => item.id);
            if (incomingItemIds.length === 0) {
                await transaction.delete(subscriptionItems).where(eq(subscriptionItems.subscriptionId, record.id));
            } else {
                await transaction.delete(subscriptionItems).where(and(
                    eq(subscriptionItems.subscriptionId, record.id),
                    notInArray(subscriptionItems.stripeId, incomingItemIds),
                ));
            }
            for (const item of subscription.items.data) {
                await transaction.insert(subscriptionItems).values({
                    subscriptionId: record.id, stripeId: item.id, stripeProduct: objectId(item.price.product),
                    stripePrice: item.price.id, quantity: item.quantity ?? null,
                    meterId: item.price.recurring?.meter ?? null, createdAt: now, updatedAt: now,
                }).onConflictDoUpdate({ target: subscriptionItems.stripeId, set: {
                    subscriptionId: record.id, stripeProduct: objectId(item.price.product), stripePrice: item.price.id,
                    quantity: item.quantity ?? null, meterId: item.price.recurring?.meter ?? null, updatedAt: now,
                }});
            }
            const customerId = objectId(subscription.customer);
            const active = ["active", "past_due", "trialing"].includes(subscription.status);
            await transaction.update(teams).set({
                stripeId: customerId, plan: active ? "pro" : "free",
                trialEndsAt: active ? dateFromUnix(subscription.trial_end) : null, updatedAt: now,
            }).where(eq(teams.id, teamId));
            return true;
        });
    }

    public async fulfillCreditPurchase(teamId: Ulid, eventId: string, credits: number, metadata: Readonly<Record<string, string>>): Promise<boolean> {
        return this.database.transaction(async (transaction) => {
            const now = new Date();
            const inserted = await transaction.insert(aiCreditTransactions).values({
                id: createUlid(), teamId, idempotencyKey: `stripe:${eventId}`, type: "purchase", model: "stripe",
                creditsCharged: 0, metadata, createdAt: now,
            }).onConflictDoNothing().returning({ id: aiCreditTransactions.id });
            if (inserted.length === 0) return false;

            const periodEndsAt = new Date(now);
            periodEndsAt.setUTCFullYear(periodEndsAt.getUTCFullYear() + 100);
            await transaction.insert(aiCreditBalances).values({
                id: createUlid(), teamId, creditsRemaining: credits, purchasedCredits: credits,
                periodStartsAt: now, periodEndsAt, createdAt: now, updatedAt: now,
            }).onConflictDoUpdate({ target: aiCreditBalances.teamId, set: {
                creditsRemaining: sql`${aiCreditBalances.creditsRemaining} + ${credits}`,
                purchasedCredits: sql`${aiCreditBalances.purchasedCredits} + ${credits}`,
                updatedAt: now,
            }});
            return true;
        });
    }
}
