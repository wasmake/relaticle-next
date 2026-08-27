import Link from "next/link";

import styles from "@/components/crm/crm.module.css";
import { WorkspaceShell } from "@/components/crm/workspace-shell";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { listTeam } from "@/server/workspaces/service";

const TeamSettingsPage = async ({ params, searchParams }: { params: Promise<{ teamSlug: string }>; searchParams: Promise<{ updated?: string; error?: string }> }) => {
    const { teamSlug } = await params;
    const auth = await requireBrowserTeam(teamSlug);
    const team = await listTeam(auth.context.userId, auth.context.teamId);
    const state = await searchParams;

    return (
        <WorkspaceShell teamSlug={teamSlug} teamName={auth.team.name} active="settings">
            <header className={styles.header}><div><h1>Workspace settings</h1></div></header>
            <nav className={styles.settingsTabs} aria-label="Workspace settings tabs"><strong>General</strong><a href="#members">Members</a><Link href={`/app/${teamSlug}/settings/custom-fields`}>Custom Fields</Link></nav>
            {state.updated === "1" ? <p role="status" className={styles.success}>Team updated.</p> : null}
            {state.error === undefined ? null : <p className={styles.error}>The team could not be updated.</p>}
            {team.canManage ? (
                <div className={styles.workspaceSettings}>
                    <section className={styles.settingsSection}>
                        <div><h2>Workspace Name</h2><p>The workspace&apos;s name and owner information.</p></div>
                        <div className={styles.settingsCard}><label>Workspace Name<input name="name" defaultValue={auth.team.name} readOnly /></label></div>
                    </section>
                    <section className={styles.settingsSection} id="members">
                        <div><h2>Add Member</h2><p>Add a new member to your workspace, allowing them to collaborate with you.</p></div>
                        <form className={styles.settingsCard} method="post" action="/auth/team"><input type="hidden" name="team_slug" value={teamSlug} /><input type="hidden" name="intent" value="invite" /><p>Please provide the email address of the person you would like to add to this workspace.</p><label>Email<input name="email" type="email" required /></label><label className={styles.roleChoice}><input type="radio" name="role" value="admin" /> <span><strong>Administrator</strong><small>Administrator users can perform any action.</small></span></label><label className={styles.roleChoice}><input type="radio" name="role" value="member" defaultChecked /> <span><strong>Editor</strong><small>Editor users have the ability to read, create, and update.</small></span></label><button type="submit">Add</button></form>
                    </section>
                    <section className={styles.settingsSection}>
                        <div><h2>Pending Invitations</h2><p>People invited to your workspace appear here until they accept.</p></div>
                        <div className={styles.settingsCard}>{team.invitations.length === 0 ? <p>No pending invitations.</p> : team.invitations.map((invitation) => <p key={invitation.id}>{invitation.email} <small>{invitation.role}</small></p>)}</div>
                    </section>
                    <section className={styles.settingsSection}>
                        <div><h2>Members</h2><p>Manage people with access to this workspace.</p></div>
                        <div className={styles.settingsCard}>{team.members.map((member) => <div className={styles.memberRow} key={member.id}><span><strong>{member.name}</strong><small>{member.email}</small></span><form method="post" action="/auth/team"><input type="hidden" name="team_slug" value={teamSlug} /><input type="hidden" name="member_id" value={member.id} /><select name="role" defaultValue={member.role ?? "member"}><option value="member">Editor</option><option value="admin">Administrator</option></select><button name="intent" value="role">Update</button><button name="intent" value="remove">Remove</button></form></div>)}</div>
                    </section>
                </div>
            ) : <p>Administrator access is required to manage this workspace.</p>}
        </WorkspaceShell>
    );
};

export default TeamSettingsPage;
