import { beforeEach, describe, expect, it, vi } from "vitest";

const { add } = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock("@/server/queue/client", () => ({
    getQueue: () => ({ add }),
}));

import { accountMailDelivery } from "@/server/accounts/delivery";

describe("account mail delivery", () => {
    beforeEach(() => add.mockReset());

    it.each([
        ["password-reset", "account.password-reset.email"],
        ["email-verification", "account.verification.email"],
        ["team-invitation", "team.invitation.email"],
        ["deletion-cancelled", "account.deletion.cancelled.email"],
        ["deletion-scheduled", "account.deletion.scheduled.email"],
        ["member-joined", "team.member.joined.email"],
        ["member-removed", "team.member.removed.email"],
        ["member-role-changed", "team.member.role-changed.email"],
    ] as const)("queues %s through the durable email worker", async (kind, jobName) => {
        await accountMailDelivery.send({ kind, recipient: "ada@example.test", subjectName: "Research", url: "https://crm.example.test/action?a=1&b=2" });
        expect(add).toHaveBeenCalledOnce();
        const [name, payload, options] = add.mock.calls[0] as [string, Record<string, unknown>, { jobId: string; attempts: number }];
        expect(name).toBe(jobName);
        expect(payload).toMatchObject({ version: 1, to: "ada@example.test", deliveryId: options.jobId });
        expect(payload.html).toContain("a=1&amp;b=2");
        expect(options.attempts).toBe(5);
    });
});
