import { ApiTokenManager } from "@/components/crm/api-token-manager";
import { WorkspaceShell } from "@/components/crm/workspace-shell";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { personalAccessTokensApiDependencies } from "@/server/personal-access-tokens/production";

import { mutateApiToken } from "./actions";

const ApiTokensPage = async ({ params }: { params: Promise<{ teamSlug: string }> }) => {
    const { teamSlug } = await params;
    const authentication = await requireBrowserTeam(teamSlug);
    const result = await personalAccessTokensApiDependencies.tokens.list(authentication.context);
    const tokens = result.map((token) => ({ ...token, lastUsedAt: token.lastUsedAt?.toISOString() ?? null, expiresAt: token.expiresAt?.toISOString() ?? null, createdAt: token.createdAt?.toISOString() ?? null, updatedAt: undefined }));
    return <WorkspaceShell teamSlug={teamSlug} teamName={authentication.team.name} active="companies"><header><p>Developer settings</p><h1>API tokens</h1><p>Create tenant-scoped credentials and grant only the abilities an integration needs.</p></header><ApiTokenManager action={mutateApiToken.bind(null, teamSlug)} tokens={tokens} /></WorkspaceShell>;
};
export default ApiTokensPage;
