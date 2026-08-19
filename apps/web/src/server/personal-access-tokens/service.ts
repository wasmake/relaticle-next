import { randomBytes } from "node:crypto";

import { ApiNotFoundError, ApiValidationError } from "@/server/api/errors";
import { hashSanctumTokenSecret } from "@/server/auth/compatibility/sanctum";
import { apiAbilities, type ApiAbility } from "@/server/context/request-context";

import type { PersonalAccessTokensRepository } from "./repository";
import type {
    CreatedPersonalAccessToken,
    PersonalAccessTokenContext,
    PersonalAccessTokenView,
} from "./types";
import { validatePersonalAccessTokenInput } from "./validation";

export class PersonalAccessTokensService {
    public constructor(
        private readonly repository: PersonalAccessTokensRepository,
        private readonly now: () => Date = () => new Date(),
        private readonly secret: () => string = () => randomBytes(32).toString("hex"),
        private readonly tokenCreated: (userId: PersonalAccessTokenContext["userId"]) => Promise<void> = async () => {},
    ) {}

    public list(
        context: PersonalAccessTokenContext,
    ): Promise<readonly PersonalAccessTokenView[]> {
        return this.repository.list(context.userId, context.teamId);
    }

    public async create(
        context: PersonalAccessTokenContext,
        body: Readonly<Record<string, unknown>>,
    ): Promise<CreatedPersonalAccessToken> {
        const occurredAt = this.now();
        const input = validatePersonalAccessTokenInput(body, occurredAt);
        const requested: readonly ApiAbility[] = (
            input.abilities as readonly string[]
        ).includes("*")
            ? apiAbilities
            : (input.abilities as readonly ApiAbility[]);
        const credential = context.credential;

        if (
            credential.kind === "personal_access_token" &&
            requested.some(
                (ability) => !credential.abilities.includes(ability),
            )
        ) {
            throw new ApiValidationError([
                {
                    path: "abilities",
                    message: "A token cannot grant abilities its credential does not have.",
                },
            ]);
        }

        const secret = this.secret();
        const token = await this.repository.create({
            userId: context.userId,
            teamId: context.teamId,
            name: input.name,
            tokenHash: hashSanctumTokenSecret(secret),
            abilities: input.abilities,
            expiresAt: input.expiresAt,
            occurredAt,
        });
        await this.tokenCreated(context.userId);

        return { token, plainTextToken: `${token.id}|${secret}` };
    }

    public async delete(
        context: PersonalAccessTokenContext,
        tokenId: string,
    ): Promise<void> {
        if (!/^[1-9][0-9]*$/u.test(tokenId)) {
            throw new ApiNotFoundError();
        }

        const deleted = await this.repository.delete(
            context.userId,
            context.teamId,
            tokenId,
        );
        if (!deleted) {
            throw new ApiNotFoundError();
        }
    }
}
