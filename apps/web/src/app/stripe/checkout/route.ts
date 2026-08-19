import { NextResponse } from "next/server";

import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { billingDependencies, checkoutIdempotencyKey, ensureStripeCustomer, requireManagedBillingWorkspace } from "@/server/billing/actions";
import { parseBoundedFormData } from "@/server/http/body";
import type { StripeObject } from "@/server/billing/stripe-client";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const form = await parseBoundedFormData(request, 16 * 1024);
    const teamSlug = textFormValue(form, "team_slug");
    const interval = textFormValue(form, "interval");
    const idempotencyToken = textFormValue(form, "idempotency_key");
    if (interval !== "monthly" && interval !== "yearly") return new Response("Invalid billing interval.", { status: 422 });

    const managed = await requireManagedBillingWorkspace(teamSlug);
    if ("response" in managed) return managed.response;

    try {
        const { configuration, stripe } = billingDependencies();
        const customer = await ensureStripeCustomer(managed.workspace, managed.authentication.user.email, managed.repository, stripe);
        const recovery = `${configuration.appUrl}/stripe/recover?team=${encodeURIComponent(teamSlug)}&session_id={CHECKOUT_SESSION_ID}`;
        const session = await stripe.create<StripeObject>("/checkout/sessions", {
            mode: "subscription", customer, "line_items[0][price]": interval === "monthly" ? configuration.monthlyPriceId : configuration.yearlyPriceId,
            "line_items[0][quantity]": 1, success_url: recovery, cancel_url: `${configuration.appUrl}/app/${encodeURIComponent(teamSlug)}/billing?checkout=canceled`,
            allow_promotion_codes: true, "metadata[team_id]": managed.workspace.id, "metadata[billing_kind]": "subscription",
            "subscription_data[metadata][team_id]": managed.workspace.id,
        }, checkoutIdempotencyKey(managed.workspace.id, "subscription", idempotencyToken));
        const url = session.url;
        if (typeof url !== "string") throw new Error("Stripe checkout did not return a URL.");
        return NextResponse.redirect(url, 303);
    } catch {
        return NextResponse.redirect(new URL(`/app/${encodeURIComponent(teamSlug)}/billing?error=stripe`, request.url), 303);
    }
};
