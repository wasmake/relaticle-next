import { requireBrowserTeam } from "@/server/auth/browser/context";
import type { Ulid } from "@/server/ids";

import { DrizzleBillingRepository } from "./commerce-repository";
import { getBillingConfiguration } from "./configuration";
import { StripeClient, type StripeObject } from "./stripe-client";

export type ManagedBillingWorkspace = Readonly<{
    id: Ulid;
    name: string;
    slug: string;
    plan: string;
    stripeId: string | null;
    pmType: string | null;
    pmLastFour: string | null;
    trialEndsAt: Date | null;
    proTrialUsedAt: Date | null;
}>;

export const requireManagedBillingWorkspace = async (teamSlug: string) => {
    const authentication = await requireBrowserTeam(teamSlug);
    const repository = new DrizzleBillingRepository();
    const canManage = await repository.canManage(authentication.context.teamId, authentication.context.userId);
    if (!canManage) return { response: new Response("Workspace administrator access is required.", { status: 403 }) } as const;

    const workspace = await repository.findWorkspace(authentication.context.teamId);
    if (workspace === undefined) return { response: new Response("Workspace not found.", { status: 404 }) } as const;

    return { authentication, repository, workspace: workspace as ManagedBillingWorkspace } as const;
};

export const ensureStripeCustomer = async (
    workspace: ManagedBillingWorkspace,
    email: string,
    repository: DrizzleBillingRepository,
    stripe: StripeClient,
): Promise<string> => {
    if (workspace.stripeId !== null) return workspace.stripeId;

    const customer = await stripe.create<StripeObject>("/customers", {
        name: workspace.name,
        email,
        "metadata[team_id]": workspace.id,
        "metadata[team_slug]": workspace.slug,
    }, `workspace-customer:${workspace.id}`);
    await repository.setCustomer(workspace.id, customer.id);
    return customer.id;
};

export const checkoutIdempotencyKey = (teamId: Ulid, kind: "subscription" | "credits", token: string): string => {
    if (!/^[A-Za-z0-9_-]{16,128}$/u.test(token)) throw new Error("A valid checkout idempotency key is required.");
    return `checkout:${teamId}:${kind}:${token}`;
};

export const billingDependencies = () => {
    const configuration = getBillingConfiguration();
    return { configuration, stripe: new StripeClient(configuration.secretKey) };
};
