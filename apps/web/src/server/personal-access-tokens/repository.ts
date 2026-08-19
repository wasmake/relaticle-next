import type { Ulid } from "@/server/ids";

import type { CreatePersonalAccessTokenInput, PersonalAccessTokenView } from "./types";

export interface PersonalAccessTokensRepository {
    list(userId: Ulid, teamId: Ulid): Promise<readonly PersonalAccessTokenView[]>;
    create(input: CreatePersonalAccessTokenInput): Promise<PersonalAccessTokenView>;
    delete(userId: Ulid, teamId: Ulid, tokenId: string): Promise<boolean>;
}
