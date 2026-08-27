import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import Link from "next/link";

import { CrmIcon } from "@/components/crm/icon";
import { WorkspaceShell } from "@/components/crm/workspace-shell";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { chatService } from "@/server/chat/production";
import { getDatabase } from "@/server/db/client";
import {
    customFieldOptions,
    customFields,
    customFieldValues,
    tasks,
    taskUser,
    users,
} from "@/server/db/schema";

type DashboardProperties = Readonly<{ params: Promise<{ teamSlug: string }> }>;
type DashboardTask = Readonly<{
    id: string;
    title: string;
    dueAt: Date | null;
}>;
const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-workspace-primary focus-visible:ring-offset-2";

const loadMyTasks = async (
    teamId: string,
    userId: string,
): Promise<readonly DashboardTask[]> => {
    const database = getDatabase();
    const assigned = await database
        .select({
            id: tasks.id,
            title: tasks.title,
            createdAt: tasks.createdAt,
        })
        .from(tasks)
        .innerJoin(taskUser, eq(taskUser.taskId, tasks.id))
        .where(
            and(
                eq(tasks.teamId, teamId),
                eq(taskUser.userId, userId),
                isNull(tasks.deletedAt),
            ),
        )
        .orderBy(desc(tasks.createdAt))
        .limit(50);

    if (assigned.length === 0) return [];

    const metadata = await database
        .select({ id: customFields.id, code: customFields.code })
        .from(customFields)
        .where(
            and(
                eq(customFields.tenantId, teamId),
                eq(customFields.entityType, "task"),
                inArray(customFields.code, ["due_date", "status"]),
            ),
        );
    const dueFieldId = metadata.find(({ code }) => code === "due_date")?.id;
    const statusFieldId = metadata.find(({ code }) => code === "status")?.id;
    const fieldIds = [dueFieldId, statusFieldId].filter(
        (id): id is string => id !== undefined,
    );
    const taskIds = assigned.map(({ id }) => id);
    const [values, doneOptions] = await Promise.all([
        fieldIds.length === 0
            ? []
            : database
                  .select({
                      entityId: customFieldValues.entityId,
                      customFieldId: customFieldValues.customFieldId,
                      stringValue: customFieldValues.stringValue,
                      datetimeValue: customFieldValues.datetimeValue,
                  })
                  .from(customFieldValues)
                  .where(
                      and(
                          eq(customFieldValues.entityType, "task"),
                          inArray(customFieldValues.entityId, taskIds),
                          inArray(customFieldValues.customFieldId, fieldIds),
                      ),
                  ),
        statusFieldId === undefined
            ? []
            : database
                  .select({ id: customFieldOptions.id })
                  .from(customFieldOptions)
                  .where(
                      and(
                          eq(customFieldOptions.customFieldId, statusFieldId),
                          eq(customFieldOptions.name, "Done"),
                      ),
                  )
                  .limit(1),
    ]);
    const doneOptionId = doneOptions[0]?.id;
    const dueByTask = new Map(
        values
            .filter(({ customFieldId }) => customFieldId === dueFieldId)
            .map(({ entityId, datetimeValue }) => [entityId, datetimeValue]),
    );
    const doneTasks = new Set(
        values
            .filter(
                ({ customFieldId, stringValue }) =>
                    customFieldId === statusFieldId &&
                    stringValue === doneOptionId,
            )
            .map(({ entityId }) => entityId),
    );

    return assigned
        .filter(({ id }) => !doneTasks.has(id))
        .map(({ id, title }) => ({
            id,
            title,
            dueAt: dueByTask.get(id) ?? null,
        }))
        .sort((left, right) =>
            left.dueAt === null
                ? 1
                : right.dueAt === null
                  ? -1
                  : left.dueAt.getTime() - right.dueAt.getTime(),
        )
        .slice(0, 5);
};

const Dashboard = async ({ params }: DashboardProperties) => {
    const { teamSlug } = await params;
    const authentication = await requireBrowserTeam(teamSlug);
    const database = getDatabase();
    const [conversations, myTasks, userPreferences] = await Promise.all([
        chatService.listConversations(authentication.context),
        loadMyTasks(
            authentication.context.teamId,
            authentication.context.userId,
        ),
        database
            .select({ timezone: users.timezone })
            .from(users)
            .where(eq(users.id, authentication.context.userId))
            .limit(1),
    ]);
    const recentChat = conversations[0];
    const timezone = userPreferences[0]?.timezone ?? "UTC";
    const hour = Number(
        new Intl.DateTimeFormat("en", {
            hour: "numeric",
            hourCycle: "h23",
            timeZone: timezone,
        }).format(new Date()),
    );
    const greeting =
        hour < 12
            ? "Good morning"
            : hour < 18
              ? "Good afternoon"
              : "Good evening";
    const date = (value: Date): string =>
        new Intl.DateTimeFormat("en", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: timezone,
        }).format(value);
    const today = new Date();

    return (
        <WorkspaceShell
            teamSlug={teamSlug}
            teamName={authentication.team.name}
            active="overview"
        >
            <section className="mx-auto w-full max-w-3xl py-16 font-ui workspace-mobile:py-10">
                <div className="text-center">
                    <h1 className="m-0 text-3xl font-semibold leading-9 tracking-tight text-zinc-950 workspace-mobile:text-2xl workspace-mobile:leading-8">
                        {greeting}, {authentication.user.name.split(" ")[0]}.
                    </h1>
                    {recentChat === undefined ? null : (
                        <Link
                            className={`mx-auto mt-2 flex max-w-full items-center justify-center gap-1.5 text-ui font-normal text-workspace-muted no-underline hover:text-workspace-text ${focusRing}`}
                            href={`/app/${teamSlug}/chat?conversation=${recentChat.id}`}
                        >
                            <CrmIcon
                                className="size-4 shrink-0"
                                name="refresh"
                            />
                            <span className="min-w-0 truncate">
                                Recent chat · {recentChat.title || "Untitled"}
                            </span>
                        </Link>
                    )}
                </div>
                <form
                    className="mt-10 overflow-hidden rounded-panel border border-workspace-border bg-workspace-surface transition-colors focus-within:border-workspace-primary focus-within:ring-1 focus-within:ring-workspace-primary"
                    action={`/app/${teamSlug}/chat`}
                >
                    <textarea
                        className="block min-h-16 w-full resize-none border-0 bg-transparent px-4 pb-2 pt-4 text-ui font-normal text-workspace-text outline-none placeholder:text-workspace-subtle"
                        aria-label="Ask anything"
                        name="message"
                        placeholder="Ask anything..."
                        maxLength={5000}
                    />
                    <footer className="flex h-10 items-center justify-end gap-2 px-3 pb-2">
                        <select
                            className={`cursor-pointer border-0 bg-transparent text-caption font-medium text-workspace-muted ${focusRing}`}
                            aria-label="AI model"
                            name="model"
                            defaultValue="auto"
                        >
                            <option value="auto">Auto</option>
                        </select>
                        <button
                            className={`grid size-8 cursor-pointer place-items-center rounded-lg border-0 bg-workspace-primary text-white hover:bg-workspace-primary-text ${focusRing}`}
                            type="submit"
                            aria-label="Send message"
                        >
                            <CrmIcon className="size-4" name="arrowUp" />
                        </button>
                    </footer>
                </form>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {[
                        "CRM overview",
                        "Overdue tasks",
                        "Recent companies",
                        "Pipeline summary",
                    ].map((label) => (
                        <Link
                            className={`inline-flex h-8 items-center rounded-full border border-workspace-border bg-workspace-surface px-3 text-caption font-medium text-workspace-muted no-underline transition-colors hover:border-violet-300 hover:bg-workspace-primary-soft hover:text-workspace-primary-text ${focusRing}`}
                            key={label}
                            href={`/app/${teamSlug}/chat?message=${encodeURIComponent(label)}`}
                        >
                            {label}
                        </Link>
                    ))}
                </div>
                <section className="mt-12">
                    <header className="mb-2 flex h-8 items-center justify-between">
                        <h2 className="m-0 flex items-baseline gap-2 text-caption font-semibold uppercase tracking-wider text-workspace-muted">
                            <span>Tasks</span>
                            <small className="text-workspace-subtle">
                                {myTasks.length}
                            </small>
                        </h2>
                        <div className="flex h-8 items-center gap-2">
                            <Link
                                className={`inline-flex h-8 items-center px-2 text-caption font-medium text-workspace-muted no-underline hover:text-workspace-text ${focusRing}`}
                                href={`/app/${teamSlug}/tasks`}
                            >
                                View all
                            </Link>
                            {myTasks.length > 0 ? (
                                <Link
                                    className={`grid size-8 place-items-center rounded-lg text-workspace-muted no-underline hover:bg-nav-hover hover:text-workspace-text ${focusRing}`}
                                    href={`/app/${teamSlug}/tasks`}
                                    aria-label="Create task"
                                >
                                    <CrmIcon className="size-4" name="plus" />
                                </Link>
                            ) : null}
                        </div>
                    </header>
                    {myTasks.length === 0 ? (
                        <div className="grid justify-items-center rounded-control border border-dashed border-workspace-border bg-workspace-surface px-6 py-10 text-center">
                            <strong className="text-ui font-semibold text-workspace-text">
                                No tasks assigned to you
                            </strong>
                            <span className="mt-1 text-caption font-normal text-workspace-muted">
                                Tasks assigned to you will appear here.
                            </span>
                            <Link
                                className={`mt-4 rounded-control bg-workspace-primary px-3 py-2 text-caption font-semibold text-white no-underline hover:bg-workspace-primary-text ${focusRing}`}
                                href={`/app/${teamSlug}/tasks`}
                            >
                                New task
                            </Link>
                        </div>
                    ) : (
                        <ul className="m-0 overflow-hidden rounded-control border border-workspace-border bg-workspace-surface p-0 shadow-control">
                            {myTasks.map((task) => (
                                <li
                                    className="list-none border-b border-nav-active last:border-b-0"
                                    key={task.id}
                                >
                                    <Link
                                        className={`flex h-12 min-w-0 items-center gap-3 px-4 text-workspace-text no-underline hover:bg-nav-hover ${focusRing}`}
                                        href={`/app/${teamSlug}/tasks/${task.id}`}
                                    >
                                        <span className="size-4 shrink-0 rounded-full border border-gray-300" />
                                        <strong className="min-w-0 flex-1 truncate text-ui font-medium">
                                            {task.title}
                                        </strong>
                                        {task.dueAt === null ? (
                                            <span className="w-28 shrink-0 workspace-mobile:w-24" />
                                        ) : (
                                            <time
                                                className={`w-28 shrink-0 whitespace-nowrap text-right text-caption font-normal tabular-nums workspace-mobile:w-24 ${task.dueAt < today ? "text-red-600" : "text-workspace-muted"}`}
                                                dateTime={task.dueAt.toISOString()}
                                            >
                                                {date(task.dueAt)}
                                            </time>
                                        )}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </section>
        </WorkspaceShell>
    );
};

export default Dashboard;
