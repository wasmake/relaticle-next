import {
    taskAssigneeEmailJobName,
    taskAssigneesAddedJobSchema,
    type TaskAssigneeEmailJob,
} from "../../../packages/queue/src/jobs.js";

export type TaskNotificationRecipient = Readonly<{
    id: string;
    name: string;
    email: string;
    notificationPreferences: unknown;
}>;

export type DatabaseNotificationRow = Readonly<{
    id: string;
    type: "Filament\\Notifications\\DatabaseNotification";
    notifiableType: "user";
    notifiableId: string;
    data: Readonly<Record<string, unknown>>;
    readAt: null;
    createdAt: Date;
    updatedAt: Date;
}>;

export interface TaskNotificationRepository {
    findTeamSlug(teamId: string): Promise<string | undefined>;
    findRecipients(
        teamId: string,
        recipientIds: readonly string[],
    ): Promise<readonly TaskNotificationRecipient[]>;
    insertDatabaseNotifications(
        rows: readonly DatabaseNotificationRow[],
    ): Promise<void>;
}

export interface TaskNotificationEmailQueue {
    add(
        name: typeof taskAssigneeEmailJobName,
        data: TaskAssigneeEmailJob,
        options: Readonly<{ jobId: string }>,
    ): Promise<unknown>;
}

export type AppPanelConfiguration = Readonly<{
    appUrl: string;
    appPanelDomain?: string;
    appPanelPath: string;
}>;

const preferenceOverride = (
    preferences: unknown,
    channel: "in_app" | "email",
): boolean | undefined => {
    if (typeof preferences !== "object" || preferences === null) {
        return undefined;
    }

    const taskAssigned = (preferences as Record<string, unknown>).task_assigned;

    if (typeof taskAssigned !== "object" || taskAssigned === null) {
        return undefined;
    }

    const value = (taskAssigned as Record<string, unknown>)[channel];

    return typeof value === "boolean" ? value : undefined;
};

const wantsInApp = (preferences: unknown): boolean =>
    preferenceOverride(preferences, "in_app") ?? true;

const wantsEmail = (preferences: unknown): boolean =>
    preferenceOverride(preferences, "email") ?? false;

export const taskUrlFor = (
    configuration: AppPanelConfiguration,
    teamSlug: string | undefined,
    taskId: string,
): string => {
    if (teamSlug === undefined) {
        return "#";
    }

    const appUrl = new URL(configuration.appUrl);
    const query = `tableAction=edit&tableActionRecord=${encodeURIComponent(taskId)}`;
    const path = `${encodeURIComponent(teamSlug)}/tasks?${query}`;

    if (configuration.appPanelDomain !== undefined) {
        const port = appUrl.port === "" ? "" : `:${appUrl.port}`;

        return `${appUrl.protocol}//${configuration.appPanelDomain}${port}/${path}`;
    }

    const panelPath = configuration.appPanelPath.replace(/^\/+|\/+$/gu, "");

    return `${configuration.appUrl.replace(/\/+$/gu, "")}/${panelPath}/${path}`;
};

const notificationData = (
    taskTitle: string,
    taskId: string,
    taskUrl: string,
): Readonly<Record<string, unknown>> => ({
    actions: [
        {
            name: "view",
            alpineClickHandler: null,
            color: null,
            event: null,
            eventData: [],
            dispatchDirection: false,
            dispatchToComponent: null,
            extraAttributes: [],
            icon: null,
            iconPosition: "before",
            iconSize: null,
            isOutlined: false,
            isDisabled: false,
            label: "View Task",
            shouldClose: false,
            shouldMarkAsRead: true,
            shouldMarkAsUnread: false,
            shouldOpenUrlInNewTab: false,
            shouldPostToUrl: false,
            size: "sm",
            tooltip: null,
            url: taskUrl,
            view: "filament::components.button.index",
        },
    ],
    body: null,
    color: null,
    duration: "persistent",
    icon: "heroicon-o-check-circle",
    iconColor: "primary",
    status: null,
    title: `New Task Assignment: ${taskTitle}`,
    view: null,
    viewData: { task_id: taskId },
    format: "filament",
});

export class TaskAssigneesAddedProcessor {
    public constructor(
        private readonly repository: TaskNotificationRepository,
        private readonly emailQueue: TaskNotificationEmailQueue,
        private readonly panel: AppPanelConfiguration,
        private readonly now: () => Date = () => new Date(),
    ) {}

    public async process(input: unknown): Promise<void> {
        const job = taskAssigneesAddedJobSchema.parse(input);
        const requestedRecipients = new Map(
            job.recipients.map((recipient) => [recipient.userId, recipient]),
        );
        const [teamSlug, recipients] = await Promise.all([
            this.repository.findTeamSlug(job.teamId),
            this.repository.findRecipients(
                job.teamId,
                [...requestedRecipients.keys()],
            ),
        ]);
        const taskUrl = taskUrlFor(this.panel, teamSlug, job.taskId);
        const occurredAt = this.now();
        const databaseRows: DatabaseNotificationRow[] = [];
        const emailJobs: Array<Promise<unknown>> = [];

        for (const recipient of recipients) {
            const requested = requestedRecipients.get(recipient.id);

            if (requested === undefined) {
                continue;
            }

            if (wantsInApp(recipient.notificationPreferences)) {
                databaseRows.push({
                    id: requested.databaseNotificationId,
                    type: "Filament\\Notifications\\DatabaseNotification",
                    notifiableType: "user",
                    notifiableId: recipient.id,
                    data: notificationData(job.taskTitle, job.taskId, taskUrl),
                    readAt: null,
                    createdAt: occurredAt,
                    updatedAt: occurredAt,
                });
            }

            if (wantsEmail(recipient.notificationPreferences)) {
                emailJobs.push(
                    this.emailQueue.add(
                        taskAssigneeEmailJobName,
                        {
                            version: 1,
                            eventId: job.eventId,
                            recipientId: recipient.id,
                            recipientName: recipient.name,
                            recipientEmail: recipient.email,
                            taskTitle: job.taskTitle,
                            taskUrl,
                        },
                        {
                            jobId: `task-assignee-email-${job.eventId}-${recipient.id}`,
                        },
                    ),
                );
            }
        }

        const operations: Array<Promise<unknown>> = [...emailJobs];

        if (databaseRows.length > 0) {
            operations.unshift(
                this.repository.insertDatabaseNotifications(databaseRows),
            );
        }

        const results = await Promise.allSettled(operations);
        const errors = results
            .filter(
                (result): result is PromiseRejectedResult =>
                    result.status === "rejected",
            )
            .map(({ reason }) => reason);

        if (errors.length > 0) {
            throw new AggregateError(
                errors,
                "Task assignment notification delivery failed.",
            );
        }
    }
}
