import type { Ulid } from "@/server/ids";

export type HostedWorkspaceSubscription = Readonly<{
    stripeStatus: string;
    trialEndsAt: Date | null;
    endsAt: Date | null;
}>;

export type HostedWorkspace = Readonly<{
    plan: string;
    trialEndsAt: Date | null;
    hostedFreeGrandfatheredAt: Date | null;
    subscription: HostedWorkspaceSubscription | null;
}>;

export interface HostedWorkspaceRepository {
    findForAccess(teamId: Ulid): Promise<HostedWorkspace | undefined>;
}

const isFuture = (value: Date | null, now: Date): boolean =>
    value !== null && value.getTime() > now.getTime();

const hasValidSubscription = (
    subscription: HostedWorkspaceSubscription | null,
    now: Date,
): boolean => {
    if (subscription === null) {
        return false;
    }

    if (
        isFuture(subscription.trialEndsAt, now) ||
        isFuture(subscription.endsAt, now)
    ) {
        return true;
    }

    if (subscription.endsAt !== null) {
        return false;
    }

    return ![
        "canceled",
        "incomplete",
        "incomplete_expired",
        "unpaid",
    ].includes(subscription.stripeStatus);
};

export const hostedWorkspaceAllows = (
    workspace: HostedWorkspace,
    now: Date,
): boolean => {
    if (workspace.hostedFreeGrandfatheredAt !== null) {
        return true;
    }

    if (hasValidSubscription(workspace.subscription, now)) {
        return true;
    }

    if (workspace.plan === "enterprise") {
        return true;
    }

    if (isFuture(workspace.trialEndsAt, now)) {
        return true;
    }

    if (workspace.trialEndsAt !== null) {
        return false;
    }

    return workspace.plan === "pro";
};

export class HostedWorkspaceAccess {
    public constructor(
        private readonly repository: HostedWorkspaceRepository,
        private readonly billingEnabled: boolean,
        private readonly now: () => Date = () => new Date(),
    ) {}

    public async allows(teamId: Ulid): Promise<boolean> {
        if (!this.billingEnabled) {
            return true;
        }

        const workspace = await this.repository.findForAccess(teamId);

        return workspace !== undefined && hostedWorkspaceAllows(workspace, this.now());
    }
}
