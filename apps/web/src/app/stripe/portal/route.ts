import { NextResponse } from "next/server";

import { rejectCrossOrigin, textFormValue } from "@/server/auth/browser/request";
import { billingDependencies, requireManagedBillingWorkspace } from "@/server/billing/actions";
import type { StripeObject } from "@/server/billing/stripe-client";

export const POST = async (request: Request): Promise<Response> => {
    const rejected = rejectCrossOrigin(request);
    if (rejected !== undefined) return rejected;
    const teamSlug = textFormValue(await request.formData(), "team_slug");
    const managed = await requireManagedBillingWorkspace(teamSlug);
    if ("response" in managed) return managed.response;
    if (managed.workspace.stripeId === null) return new Response("This workspace has no billing account.", { status: 409 });

    try {
        const { configuration, stripe } = billingDependencies();
        const session = await stripe.create<StripeObject>("/billing_portal/sessions", {
            customer: managed.workspace.stripeId,
            return_url: `${configuration.appUrl}/app/${encodeURIComponent(teamSlug)}/billing`,
        });
        if (typeof session.url !== "string") throw new Error("Stripe portal did not return a URL.");
        return NextResponse.redirect(session.url, 303);
    } catch {
        return NextResponse.redirect(new URL(`/app/${encodeURIComponent(teamSlug)}/billing?error=stripe`, request.url), 303);
    }
};
