import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import Link from "next/link";

import { CrmIcon } from "@/components/crm/icon";
import { WorkspaceShell } from "@/components/crm/workspace-shell";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { chatService } from "@/server/chat/production";
import { getDatabase } from "@/server/db/client";
import { customFieldOptions, customFields, customFieldValues, tasks, taskUser, users } from "@/server/db/schema";

type DashboardProperties = Readonly<{ params: Promise<{ teamSlug: string }> }>;
type DashboardTask = Readonly<{ id: string; title: string; dueAt: Date | null }>;

const loadMyTasks = async (teamId: string, userId: string): Promise<readonly DashboardTask[]> => {
    const database = getDatabase();
    const assigned = await database
        .select({ id: tasks.id, title: tasks.title, createdAt: tasks.createdAt })
        .from(tasks)
        .innerJoin(taskUser, eq(taskUser.taskId, tasks.id))
        .where(and(eq(tasks.teamId, teamId), eq(taskUser.userId, userId), isNull(tasks.deletedAt)))
        .orderBy(desc(tasks.createdAt))
        .limit(50);

    if (assigned.length === 0) return [];

    const metadata = await database
        .select({ id: customFields.id, code: customFields.code })
        .from(customFields)
        .where(and(eq(customFields.tenantId, teamId), eq(customFields.entityType, "task"), inArray(customFields.code, ["due_date", "status"])));
    const dueFieldId = metadata.find(({ code }) => code === "due_date")?.id;
    const statusFieldId = metadata.find(({ code }) => code === "status")?.id;
    const fieldIds = [dueFieldId, statusFieldId].filter((id): id is string => id !== undefined);
    const taskIds = assigned.map(({ id }) => id);
    const [values, doneOptions] = await Promise.all([
        fieldIds.length === 0 ? [] : database
            .select({ entityId: customFieldValues.entityId, customFieldId: customFieldValues.customFieldId, stringValue: customFieldValues.stringValue, datetimeValue: customFieldValues.datetimeValue })
            .from(customFieldValues)
            .where(and(eq(customFieldValues.entityType, "task"), inArray(customFieldValues.entityId, taskIds), inArray(customFieldValues.customFieldId, fieldIds))),
        statusFieldId === undefined ? [] : database
            .select({ id: customFieldOptions.id })
            .from(customFieldOptions)
            .where(and(eq(customFieldOptions.customFieldId, statusFieldId), eq(customFieldOptions.name, "Done")))
            .limit(1),
    ]);
    const doneOptionId = doneOptions[0]?.id;
    const dueByTask = new Map(values.filter(({ customFieldId }) => customFieldId === dueFieldId).map(({ entityId, datetimeValue }) => [entityId, datetimeValue]));
    const doneTasks = new Set(values.filter(({ customFieldId, stringValue }) => customFieldId === statusFieldId && stringValue === doneOptionId).map(({ entityId }) => entityId));

    return assigned
        .filter(({ id }) => !doneTasks.has(id))
        .map(({ id, title }) => ({ id, title, dueAt: dueByTask.get(id) ?? null }))
        .sort((left, right) => left.dueAt === null ? 1 : right.dueAt === null ? -1 : left.dueAt.getTime() - right.dueAt.getTime())
        .slice(0, 5);
};

const Dashboard = async ({ params }: DashboardProperties) => {
    const { teamSlug } = await params;
    const authentication = await requireBrowserTeam(teamSlug);
    const database = getDatabase();
    const [conversations, myTasks, userPreferences] = await Promise.all([
        chatService.listConversations(authentication.context),
        loadMyTasks(authentication.context.teamId, authentication.context.userId),
        database.select({ timezone: users.timezone }).from(users).where(eq(users.id, authentication.context.userId)).limit(1),
    ]);
    const recentChat = conversations[0];
    const timezone = userPreferences[0]?.timezone ?? "UTC";
    const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date()));
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const date = (value: Date): string => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(value);
    const today = new Date();

    return (
        <WorkspaceShell teamSlug={teamSlug} teamName={authentication.team.name} active="overview">
            <section className="crm-dashboard">
                <div className="dashboard-greeting">
                    <h1>{greeting}, {authentication.user.name.split(" ")[0]}.</h1>
                    {recentChat === undefined ? null : <Link href={`/app/${teamSlug}/chat?conversation=${recentChat.id}`}><CrmIcon name="refresh" />Recent chat · {recentChat.title || "Untitled"}</Link>}
                </div>
                <form className="dashboard-composer" action={`/app/${teamSlug}/chat`}>
                    <textarea autoFocus aria-label="Ask anything" name="message" placeholder="Ask anything..." maxLength={5000} />
                    <footer><select aria-label="AI model" name="model" defaultValue="auto"><option value="auto">Auto</option></select><button type="submit" aria-label="Send message"><CrmIcon name="arrowUp" /></button></footer>
                </form>
                <div className="dashboard-prompts">
                    {["CRM overview", "Overdue tasks", "Recent companies", "Pipeline summary"].map((label) => <Link key={label} href={`/app/${teamSlug}/chat?message=${encodeURIComponent(label)}`}>{label}</Link>)}
                </div>
                <section className="dashboard-tasks">
                    <header><h2><span>Tasks</span><small>{myTasks.length}</small></h2><div><Link href={`/app/${teamSlug}/tasks`}>View all</Link>{myTasks.length > 0 ? <Link href={`/app/${teamSlug}/tasks`} aria-label="Create task"><CrmIcon name="plus" /></Link> : null}</div></header>
                    {myTasks.length === 0 ? <div className="dashboard-task-empty"><strong>No tasks assigned to you</strong><span>Tasks assigned to you will appear here.</span><Link href={`/app/${teamSlug}/tasks`}>New task</Link></div> : <ul>{myTasks.map((task) => <li key={task.id}><Link href={`/app/${teamSlug}/tasks/${task.id}`}><span className="task-check" /><strong>{task.title}</strong>{task.dueAt === null ? null : <time className={task.dueAt < today ? "is-overdue" : undefined}>{date(task.dueAt)}</time>}</Link></li>)}</ul>}
                </section>
            </section>
        </WorkspaceShell>
    );
};

export default Dashboard;
