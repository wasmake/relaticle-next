"use server";

import { revalidatePath } from "next/cache";

import { ApiValidationError } from "@/server/api/errors";
import { requireBrowserTeam } from "@/server/auth/browser/context";
import { personalAccessTokensApiDependencies } from "@/server/personal-access-tokens/production";

export type TokenState = Readonly<{ status: "idle" | "error" | "success"; message: string; token?: string }>;
const text = (data: FormData, key: string): string => typeof data.get(key) === "string" ? data.get(key) as string : "";

export const mutateApiToken = async (teamSlug: string, _state: TokenState, data: FormData): Promise<TokenState> => {
    const authentication = await requireBrowserTeam(teamSlug);
    try {
        if (text(data, "intent") === "delete") {
            await personalAccessTokensApiDependencies.tokens.delete(authentication.context, text(data, "id"));
            revalidatePath(`/app/${teamSlug}/settings/api-tokens`);
            return { status: "success", message: "Token revoked." };
        }
        const abilities = data.getAll("abilities").filter((value): value is string => typeof value === "string");
        const expires = text(data, "expires_at");
        const created = await personalAccessTokensApiDependencies.tokens.create(authentication.context, { name: text(data, "name"), abilities, expires_at: expires === "" ? null : new Date(`${expires}T23:59:59Z`).toISOString() });
        revalidatePath(`/app/${teamSlug}/settings/api-tokens`);
        return { status: "success", message: "Copy this token now. It will not be shown again.", token: created.plainTextToken };
    } catch (error) {
        if (error instanceof ApiValidationError) return { status: "error", message: error.issues[0]?.message ?? "Check the token settings." };
        console.error("Browser token mutation failed", error);
        return { status: "error", message: "The token change could not be saved." };
    }
};
