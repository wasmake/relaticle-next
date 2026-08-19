import type { Ulid } from "@/server/ids";

export type StripeSubscription = Readonly<{
    id: string;
    customer: string | Readonly<{ id: string }>;
    status: string;
    metadata?: Readonly<Record<string, string>>;
    trial_end?: number | null;
    cancel_at?: number | null;
    canceled_at?: number | null;
    current_period_end?: number | null;
    items: Readonly<{
        data: readonly Readonly<{
            id: string;
            quantity?: number | null;
            price: Readonly<{
                id: string;
                product: string | Readonly<{ id: string }>;
                recurring?: Readonly<{ meter?: string | null }> | null;
            }>;
        }>[];
    }>;
}>;

export type StripeCheckoutSession = Readonly<{
    id: string;
    customer?: string | Readonly<{ id: string }> | null;
    subscription?: string | Readonly<{ id: string }> | null;
    payment_status?: string;
    mode?: string;
    metadata?: Readonly<Record<string, string>>;
}>;

export type StripeEvent = Readonly<{
    id: string;
    type: string;
    created?: number;
    data: Readonly<{ object: unknown }>;
}>;

export interface BillingSynchronizationRepository {
    findTeamIdByCustomer(customerId: string): Promise<Ulid | undefined>;
    synchronizeSubscription(teamId: Ulid, subscription: StripeSubscription, event: Readonly<{ id: string; createdAt: Date }>): Promise<boolean>;
    fulfillCreditPurchase(teamId: Ulid, eventId: string, credits: number, metadata: Readonly<Record<string, string>>): Promise<boolean>;
}

const objectId = (value: string | Readonly<{ id: string }>): string =>
    typeof value === "string" ? value : value.id;

const metadataTeamId = (metadata: Readonly<Record<string, string>> | undefined): Ulid | undefined => {
    const id = metadata?.team_id;
    return id !== undefined && /^[0-9A-HJKMNP-TV-Z]{26}$/iu.test(id) ? id.toUpperCase() as Ulid : undefined;
};

export const teamIdForStripeObject = async (
    object: Readonly<{ metadata?: Readonly<Record<string, string>>; customer?: string | Readonly<{ id: string }> | null }>,
    repository: BillingSynchronizationRepository,
): Promise<Ulid | undefined> => {
    const fromMetadata = metadataTeamId(object.metadata);
    if (object.customer === undefined || object.customer === null) return undefined;
    const fromCustomer = await repository.findTeamIdByCustomer(objectId(object.customer));
    if (fromMetadata !== undefined && fromCustomer !== undefined && fromMetadata !== fromCustomer) throw new Error("Stripe customer does not belong to the metadata workspace.");
    return fromCustomer;
};

const isSubscription = (value: unknown): value is StripeSubscription => {
    const candidate = value as Partial<StripeSubscription> | null;
    return candidate !== null && typeof candidate === "object" && typeof candidate.id === "string"
        && typeof candidate.status === "string" && candidate.customer !== undefined && candidate.items !== undefined
        && Array.isArray(candidate.items.data);
};

const isCheckoutSession = (value: unknown): value is StripeCheckoutSession => {
    const candidate = value as Partial<StripeCheckoutSession> | null;
    return candidate !== null && typeof candidate === "object" && typeof candidate.id === "string";
};

export const synchronizeStripeEvent = async (
    event: StripeEvent,
    repository: BillingSynchronizationRepository,
    creditPackCredits: number,
): Promise<"handled" | "ignored"> => {
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
        if (!isSubscription(event.data.object)) throw new Error("Stripe subscription payload is invalid.");
        const teamId = await teamIdForStripeObject(event.data.object, repository);
        if (teamId === undefined) throw new Error("Stripe subscription is not linked to a workspace.");
        const eventCreated = event.created;
        if (!Number.isSafeInteger(eventCreated) || eventCreated === undefined || eventCreated < 1) throw new Error("Stripe event timestamp is invalid.");
        await repository.synchronizeSubscription(teamId, event.data.object, { id: event.id, createdAt: new Date(eventCreated * 1000) });
        return "handled";
    }

    if (event.type === "checkout.session.completed") {
        if (!isCheckoutSession(event.data.object)) throw new Error("Stripe checkout payload is invalid.");
        const session = event.data.object;
        if (session.metadata?.billing_kind !== "credits" || session.payment_status !== "paid") return "ignored";
        const teamId = await teamIdForStripeObject(session, repository);
        if (teamId === undefined) throw new Error("Stripe checkout is not linked to a workspace.");
        const requestedCredits = Number(session.metadata.credit_amount);
        const credits = Number.isSafeInteger(requestedCredits) && requestedCredits > 0 ? requestedCredits : creditPackCredits;
        await repository.fulfillCreditPurchase(teamId, `checkout:${session.id}`, credits, { checkout_session_id: session.id, event_id: event.id });
        return "handled";
    }

    return "ignored";
};
