import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { synchronizeStripeEvent, type BillingSynchronizationRepository, type StripeSubscription } from "@/server/billing/service";
import { checkoutIdempotencyKey } from "@/server/billing/actions";
import { StripeClient, StripeRequestError } from "@/server/billing/stripe-client";
import { StripeSignatureError, verifyStripeSignature } from "@/server/billing/webhook-signature";
import type { Ulid } from "@/server/ids";

const teamId = "01ARZ3NDEKTSV4RRFFQ69G5FAV" as Ulid;

describe("Stripe webhook signatures", () => {
    it("validates the raw body and supports secret rotation signatures", () => {
        const payload = '{"id":"evt_1"}';
        const timestamp = 1_700_000_000;
        const signature = createHmac("sha256", "whsec_test").update(`${timestamp}.${payload}`).digest("hex");

        expect(() => verifyStripeSignature(payload, `t=${timestamp},v1=old,v1=${signature}`, "whsec_test", timestamp)).not.toThrow();
        expect(() => verifyStripeSignature(`${payload} `, `t=${timestamp},v1=${signature}`, "whsec_test", timestamp)).toThrow(StripeSignatureError);
    });

    it("rejects stale signatures before processing an event", () => {
        const signature = createHmac("sha256", "secret").update("100.payload").digest("hex");
        expect(() => verifyStripeSignature("payload", `t=100,v1=${signature}`, "secret", 401, 300)).toThrow(StripeSignatureError);
    });
});

describe("Stripe API client", () => {
    it("uses Basic Stripe form encoding, bearer auth, and idempotency keys", async () => {
        const stripeFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "cs_test", url: "https://checkout.stripe.test" }));
        const client = new StripeClient("sk_test", stripeFetch, "https://stripe.test/v1");
        await client.create("/checkout/sessions", { mode: "payment", "metadata[team_id]": teamId }, "checkout-key");

        const [url, init] = stripeFetch.mock.calls[0] ?? [];
        expect(url).toBe("https://stripe.test/v1/checkout/sessions");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk_test");
        expect(new Headers(init?.headers).get("idempotency-key")).toBe("checkout-key");
        expect(String(init?.body)).toContain(`metadata%5Bteam_id%5D=${teamId}`);
    });

    it("surfaces Stripe's response message", async () => {
        const stripeFetch = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: "Unknown price" } }, { status: 400 }));
        await expect(new StripeClient("sk_test", stripeFetch).retrieve("/prices/bad")).rejects.toEqual(expect.objectContaining<Partial<StripeRequestError>>({ message: "Unknown price", status: 400 }));
    });
});

class MemoryBillingRepository implements BillingSynchronizationRepository {
    public subscriptions: StripeSubscription[] = [];
    public credits = 0;
    private readonly fulfilled = new Set<string>();
    private subscriptionEvent: { createdAt: Date; id: string } | undefined;

    public async findTeamIdByCustomer(customerId: string): Promise<Ulid | undefined> {
        return customerId === "cus_known" ? teamId : undefined;
    }

    public async synchronizeSubscription(_teamId: Ulid, subscription: StripeSubscription, event: { createdAt: Date; id: string }): Promise<boolean> {
        if (this.subscriptionEvent !== undefined && (event.createdAt < this.subscriptionEvent.createdAt || (event.createdAt.getTime() === this.subscriptionEvent.createdAt.getTime() && event.id <= this.subscriptionEvent.id))) return false;
        this.subscriptionEvent = event;
        this.subscriptions.push(subscription);
        return true;
    }

    public async fulfillCreditPurchase(_teamId: Ulid, eventId: string, credits: number): Promise<boolean> {
        if (this.fulfilled.has(eventId)) return false;
        this.fulfilled.add(eventId);
        this.credits += credits;
        return true;
    }
}

describe("Stripe billing synchronization", () => {
    it("synchronizes subscriptions by customer when event metadata is absent", async () => {
        const repository = new MemoryBillingRepository();
        await synchronizeStripeEvent({ id: "evt_sub", type: "customer.subscription.updated", created: 100, data: { object: {
            id: "sub_1", customer: "cus_known", status: "active", items: { data: [] },
        } } }, repository, 1000);
        expect(repository.subscriptions).toHaveLength(1);
    });

    it("does not let an older subscription event overwrite newer state", async () => {
        const repository = new MemoryBillingRepository();
        const subscription = (status: string): StripeSubscription => ({ id: "sub_1", customer: "cus_known", status, items: { data: [] } });
        await synchronizeStripeEvent({ id: "evt_new", type: "customer.subscription.updated", created: 200, data: { object: subscription("active") } }, repository, 1000);
        await synchronizeStripeEvent({ id: "evt_old", type: "customer.subscription.deleted", created: 100, data: { object: subscription("canceled") } }, repository, 1000);
        expect(repository.subscriptions.map(({ status }) => status)).toEqual(["active"]);
    });

    it("rejects workspace metadata that disagrees with the Stripe customer", async () => {
        const repository = new MemoryBillingRepository();
        const otherTeam = "01ARZ3NDEKTSV4RRFFQ69G5FAA" as Ulid;
        await expect(synchronizeStripeEvent({ id: "evt_wrong", type: "customer.subscription.updated", created: 100, data: { object: {
            id: "sub_1", customer: "cus_known", status: "active", metadata: { team_id: otherTeam }, items: { data: [] },
        } } }, repository, 1000)).rejects.toThrow("does not belong");
    });

    it("fulfills a paid credit checkout only once across webhook retries", async () => {
        const repository = new MemoryBillingRepository();
        const event = { id: "evt_credit", type: "checkout.session.completed", data: { object: {
            id: "cs_paid", customer: "cus_known", mode: "payment", payment_status: "paid",
            metadata: { team_id: teamId, billing_kind: "credits", credit_amount: "250" },
        } } } as const;
        await synchronizeStripeEvent(event, repository, 1000);
        await synchronizeStripeEvent(event, repository, 1000);
        expect(repository.credits).toBe(250);
    });

    it("does not grant credits for an unpaid checkout", async () => {
        const repository = new MemoryBillingRepository();
        const result = await synchronizeStripeEvent({ id: "evt_unpaid", type: "checkout.session.completed", data: { object: {
            id: "cs_unpaid", payment_status: "unpaid", metadata: { team_id: teamId, billing_kind: "credits" },
        } } }, repository, 1000);
        expect(result).toBe("ignored");
        expect(repository.credits).toBe(0);
    });
});

describe("Stripe checkout idempotency", () => {
    it("scopes a validated browser token to the workspace and checkout kind", () => {
        expect(checkoutIdempotencyKey(teamId, "credits", "1234567890abcdef")).toBe(`checkout:${teamId}:credits:1234567890abcdef`);
        expect(() => checkoutIdempotencyKey(teamId, "credits", "short")).toThrow("idempotency");
    });
});
