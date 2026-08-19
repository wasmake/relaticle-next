import { count, eq } from "drizzle-orm";
import Link from "next/link";

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

    return (
        <main className="workspace-page">
            <aside className="workspace-sidebar">
                <Link href={`/app/${teamSlug}`} className="wordmark">Relaticle</Link>
                <p className="workspace-name">{authentication.team.name}</p>
                <nav aria-label="Workspace">
                    <Link href={`/app/${teamSlug}`}>Overview</Link>
                    {resources.map((resource) => (
                        <Link key={resource} href={`/app/${teamSlug}/${resource.toLowerCase()}`}>{resource}</Link>
                    ))}
                    <Link href={`/app/${teamSlug}/settings/team`}>Team settings</Link>
                    <Link href={`/app/${teamSlug}/billing`}>Billing</Link>
                    <Link href="/app/settings/profile">Account settings</Link>
                    <Link href="/app/new">Switch workspace</Link>
                </nav>
            </aside>
            <section className="workspace-content">
                <p className="eyebrow">Workspace overview</p>
                <h1>Good to see you, {authentication.user.name.split(" ")[0]}.</h1>
                <p className="lede">A live view of the records your team is moving forward.</p>
                <div className="metric-grid">
                    {resources.map((resource, index) => (
                        <Link className="metric" key={resource} href={`/app/${teamSlug}/${resource.toLowerCase()}`}>
                            <span>{resource}</span>
                            <strong>{totals[index]}</strong>
                        </Link>
                    ))}
                </div>
            </section>
        </main>
    );
};

export default Dashboard;
