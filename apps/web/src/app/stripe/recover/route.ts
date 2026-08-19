import { NextResponse } from "next/server";

import { billingDependencies, requireManagedBillingWorkspace } from "@/server/billing/actions";
import type { StripeCheckoutSession, StripeSubscription } from "@/server/billing/service";

export const GET = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const teamSlug = url.searchParams.get("team") ?? "";
    const sessionId = url.searchParams.get("session_id") ?? "";
    if (!/^cs_[A-Za-z0-9_]+$/u.test(sessionId)) return new Response("Invalid checkout session.", { status: 400 });
    const managed = await requireManagedBillingWorkspace(teamSlug);
    if ("response" in managed) return managed.response;

    try {
        const { configuration, stripe } = billingDependencies();
        const session = await stripe.retrieve<StripeCheckoutSession & { id: string }>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
        if (session.metadata?.team_id !== managed.workspace.id) return new Response("Checkout session does not belong to this workspace.", { status: 403 });
        const customerId = session.customer === undefined || session.customer === null ? undefined : typeof session.customer === "string" ? session.customer : session.customer.id;
        if (customerId === undefined || customerId !== managed.workspace.stripeId) return new Response("Checkout customer does not belong to this workspace.", { status: 403 });
        if (session.mode === "payment" && session.payment_status === "paid" && session.metadata.billing_kind === "credits") {
            const requested = Number(session.metadata.credit_amount);
            const credits = Number.isSafeInteger(requested) && requested > 0 ? requested : configuration.creditPackCredits;
            await managed.repository.fulfillCreditPurchase(managed.workspace.id, `checkout:${session.id}`, credits, { checkout_session_id: session.id, recovered: "true" });
        } else if (session.mode === "subscription" && session.subscription !== undefined && session.subscription !== null) {
            const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
            const subscription = await stripe.retrieve<StripeSubscription & { id: string }>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
            const subscriptionCustomer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
            if (subscriptionCustomer !== customerId) return new Response("Subscription customer does not belong to this workspace.", { status: 403 });
            await managed.repository.synchronizeSubscription(managed.workspace.id, subscription, { id: `recovery:${session.id}`, createdAt: new Date() });
        }
        return NextResponse.redirect(new URL(`/app/${encodeURIComponent(teamSlug)}/billing?checkout=success`, request.url), 303);
    } catch {
        return NextResponse.redirect(new URL(`/app/${encodeURIComponent(teamSlug)}/billing?error=recovery`, request.url), 303);
    }
};
