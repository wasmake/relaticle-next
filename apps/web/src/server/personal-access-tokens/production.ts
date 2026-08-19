import { productionApiAccessResolver } from "@/server/api/production";
import { queueMailcoachEvent } from "@/server/accounts/mailcoach";

import { DrizzlePersonalAccessTokensRepository } from "./drizzle-repository";
import type { PersonalAccessTokensApiDependencies } from "./handler";
import { PersonalAccessTokensService } from "./service";

export const personalAccessTokensApiDependencies: PersonalAccessTokensApiDependencies = {
    auth: productionApiAccessResolver,
    tokens: new PersonalAccessTokensService(
        new DrizzlePersonalAccessTokensRepository(),
        undefined,
        undefined,
        (userId) => queueMailcoachEvent(userId, "first-token"),
    ),
};
