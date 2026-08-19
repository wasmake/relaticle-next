import type { PersonalAccessTokenView } from "./types";

const date = (value: Date | null): string | null =>
    value === null ? null : value.toISOString().replace(/Z$/u, "000Z");

export const personalAccessTokenResource = (token: PersonalAccessTokenView) => ({
    id: token.id,
    type: "personal-access-tokens",
    attributes: {
        name: token.name,
        abilities: token.abilities,
        last_used_at: date(token.lastUsedAt),
        expires_at: date(token.expiresAt),
        created_at: date(token.createdAt),
        updated_at: date(token.updatedAt),
    },
});
