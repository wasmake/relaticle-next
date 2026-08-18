import type { TaskAssigneeEmailJob } from "../../../packages/queue/src/jobs.js";

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/gu, (character) => {
        const entities: Readonly<Record<string, string>> = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;",
        };

        return entities[character] ?? character;
    });

export type RenderedTaskAssignedMail = Readonly<{
    subject: string;
    html: string;
    text: string;
}>;

export const renderTaskAssignedMail = (
    job: TaskAssigneeEmailJob,
): RenderedTaskAssignedMail => {
    const taskTitle = escapeHtml(job.taskTitle);
    const taskUrl = escapeHtml(job.taskUrl);

    return {
        subject: `You've been assigned a task: ${job.taskTitle}`,
        html: `<h1>New task assigned to you</h1><p><strong>${taskTitle}</strong></p><p><a href="${taskUrl}">View task</a></p>`,
        text: `New task assigned to you\n\n${job.taskTitle}\n\nView task: ${job.taskUrl}`,
    };
};
