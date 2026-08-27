import { count, eq } from "drizzle-orm";
import Link from "next/link";

import { WorkspaceShell } from "@/components/crm/workspace-shell";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { getDatabase } from "@/server/db/client";
import { companies, notes, opportunities, people, tasks } from "@/server/db/schema";

type DashboardProperties = Readonly<{
    params: Promise<{ teamSlug: string }>;
}>;

const Dashboard = async ({ params }: DashboardProperties) => {
    const { teamSlug } = await params;
    const authentication = await requireBrowserTeam(teamSlug);
    const database = getDatabase();
    const tables = [companies, people, opportunities, tasks, notes] as const;
    const totals = await Promise.all(
        tables.map(async (table) => {
            const [row] = await database
                .select({ total: count() })
                .from(table)
                .where(eq(table.teamId, authentication.context.teamId));

            return row?.total ?? 0;
        }),
    );
    const resources = ["Companies", "People", "Opportunities", "Tasks", "Notes"];
    const hour = new Date().getUTCHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

    return (
        <WorkspaceShell teamSlug={teamSlug} teamName={authentication.team.name} active="overview">
            <section className="crm-dashboard">
                <h1>{greeting}, {authentication.user.name.split(" ")[0]}.</h1>
                <form className="dashboard-composer" action={`/app/${teamSlug}/chat`}>
                    <textarea aria-label="Ask anything" name="message" placeholder="Ask anything..." />
                    <footer><span>Auto</span><button type="submit" aria-label="Send message">↑</button></footer>
                </form>
                <div className="dashboard-prompts">
                    <Link href={`/app/${teamSlug}/chat`}>Summarize my workspace</Link>
                    <Link href={`/app/${teamSlug}/chat`}>What should I follow up on?</Link>
                    <Link href={`/app/${teamSlug}/chat`}>Show pipeline insights</Link>
                </div>
                <section className="dashboard-tasks">
                    <header><div><h2>Workspace records</h2><p>Your team&apos;s current CRM activity.</p></div><Link href={`/app/${teamSlug}/tasks`}>View tasks</Link></header>
                    <div>{resources.map((resource, index) => <Link key={resource} href={`/app/${teamSlug}/${resource.toLowerCase()}`}><span>{resource}</span><strong>{totals[index]}</strong></Link>)}</div>
                </section>
            </section>
        </WorkspaceShell>
    );
};

export default Dashboard;
