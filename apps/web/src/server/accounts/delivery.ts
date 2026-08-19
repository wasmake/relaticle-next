import {
    accountPasswordResetEmailJobName,
    accountVerificationEmailJobName,
    accountDeletionCancelledEmailJobName,
    accountDeletionScheduledEmailJobName,
    jobOptionsFor,
    teamInvitationEmailJobName,
    teamMemberJoinedEmailJobName,
    teamMemberRemovedEmailJobName,
    teamMemberRoleChangedEmailJobName,
} from "@queue/jobs";

import { getQueue } from "@/server/queue/client";

export type AccountMail = Readonly<{
    kind: "password-reset" | "email-verification" | "team-invitation" | "deletion-cancelled" | "deletion-scheduled" | "member-joined" | "member-removed" | "member-role-changed";
    recipient: string;
    url?: string | undefined;
    subjectName?: string;
}>;

export interface AccountMailDelivery {
    send(message: AccountMail): Promise<void>;
}

const escapeHtml = (value: string): string => value
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const definition = (message: AccountMail) => {
    if (message.kind === "password-reset") return { name: accountPasswordResetEmailJobName, subject: "Reset your password" } as const;
    if (message.kind === "email-verification") return { name: accountVerificationEmailJobName, subject: "Verify your email address" } as const;
    if (message.kind === "team-invitation") return { name: teamInvitationEmailJobName, subject: "You have been invited to a workspace" } as const;
    if (message.kind === "deletion-cancelled") return { name: accountDeletionCancelledEmailJobName, subject: "Account deletion cancelled" } as const;
    if (message.kind === "deletion-scheduled") return { name: accountDeletionScheduledEmailJobName, subject: "Account deletion scheduled" } as const;
    if (message.kind === "member-joined") return { name: teamMemberJoinedEmailJobName, subject: `${message.subjectName ?? "A member"} workspace member joined` } as const;
    if (message.kind === "member-removed") return { name: teamMemberRemovedEmailJobName, subject: `You were removed from ${message.subjectName ?? "a workspace"}` } as const;
    return { name: teamMemberRoleChangedEmailJobName, subject: `Your role in ${message.subjectName ?? "a workspace"} changed` } as const;
};

export const accountMailDelivery: AccountMailDelivery = {
    async send(message) {
        const delivery = definition(message);
        const identity = `${message.kind}:${message.recipient}:${message.url ?? ""}:${message.subjectName ?? ""}`;
        const options = jobOptionsFor(delivery.name, identity);
        await getQueue("default").add(delivery.name, {
            version: 1,
            deliveryId: options.jobId,
            to: message.recipient,
            subject: delivery.subject,
            html: message.url === undefined
                ? `<p>${escapeHtml(delivery.subject)}</p>`
                : `<p>${escapeHtml(delivery.subject)}</p><p><a href="${escapeHtml(message.url)}">Continue</a></p>`,
            text: message.url === undefined ? delivery.subject : `${delivery.subject}: ${message.url}`,
        }, options);
    },
};
