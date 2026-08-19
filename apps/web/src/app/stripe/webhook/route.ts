import { getBillingConfiguration } from "@/server/billing/configuration";
import { DrizzleBillingRepository } from "@/server/billing/commerce-repository";
import { synchronizeStripeEvent, type StripeEvent } from "@/server/billing/service";
import { StripeSignatureError, verifyStripeSignature } from "@/server/billing/webhook-signature";
import { readBoundedText, RequestBodyTooLargeError } from "@/server/http/body";

export const POST = async (request: Request): Promise<Response> => {
    try {
        const payload = await readBoundedText(request);
        const configuration = getBillingConfiguration();
        verifyStripeSignature(payload, request.headers.get("stripe-signature"), configuration.webhookSecret);
        const event: unknown = JSON.parse(payload);
        if (typeof event !== "object" || event === null || !("id" in event) || !("type" in event) || !("data" in event)) {
            return new Response("Invalid event.", { status: 400 });
        }
        await synchronizeStripeEvent(event as StripeEvent, new DrizzleBillingRepository(), configuration.creditPackCredits);
        return Response.json({ received: true });
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError) return new Response("Webhook is too large.", { status: 413 });
        if (error instanceof StripeSignatureError || error instanceof SyntaxError) {
            return new Response("Invalid webhook.", { status: 400 });
        }
        console.error("Stripe webhook synchronization failed", error);
        return new Response("Webhook synchronization failed.", { status: 500 });
    }
};
