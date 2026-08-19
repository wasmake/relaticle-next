import { requireBrowserUser } from "@/server/auth/browser/context";
import { listWorkspaces } from "@/server/workspaces/service";

const NewWorkspacePage = async ({ searchParams }: { searchParams: Promise<{ error?: string }> }) => {
    const identity = await requireBrowserUser();
    const workspaces = await listWorkspaces(identity.userId);
    const { error } = await searchParams;
    return <main className="account-page"><header className="account-header"><div><p className="eyebrow">Workspace directory</p><h1>Where are you working?</h1></div><form method="post" action="/auth/logout"><button className="text-button">Sign out</button></form></header><section className="account-grid"><article className="account-panel"><h2>Create a workspace</h2>{error === undefined ? null : <p className="form-error">Enter a valid workspace name.</p>}<form className="stack-form" method="post" action="/auth/workspaces"><label htmlFor="name">Workspace name</label><input id="name" name="name" required minLength={2} /><label htmlFor="use_case">What will your team manage?</label><select id="use_case" name="use_case"><option value="sales">Sales relationships</option><option value="partnerships">Partnerships</option><option value="fundraising">Fundraising</option><option value="other">Something else</option></select><label htmlFor="referral_source">How did you hear about Relaticle?</label><input id="referral_source" name="referral_source" maxLength={255} /><button type="submit">Create workspace</button></form></article><article className="account-panel"><h2>Your workspaces</h2>{workspaces.length === 0 ? <p>No workspaces yet.</p> : workspaces.map((workspace) => <form key={workspace.id} className="workspace-choice" method="post" action="/auth/workspaces/switch"><input type="hidden" name="team_id" value={workspace.id} /><span>{workspace.name}</span><button type="submit">Open</button></form>)}</article></section></main>;
};
export default NewWorkspacePage;
