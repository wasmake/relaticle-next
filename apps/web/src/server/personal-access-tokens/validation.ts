import { ApiValidationError } from "@/server/api/errors";
import { apiAbilities, type ApiAbility } from "@/server/context/request-context";

export type ValidatedPersonalAccessTokenInput = Readonly<{
    name: string;
    abilities: readonly ApiAbility[] | readonly ["*"];
    expiresAt: Date | null;
}>;

export const validatePersonalAccessTokenInput = (
    body: Readonly<Record<string, unknown>>,
    now: Date,
): ValidatedPersonalAccessTokenInput => {
    const issues: { path: string; message: string }[] = [];
    const name = body.name;
    const rawAbilities = body.abilities ?? ["*"];
    const rawExpiration = body.expires_at ?? null;

    if (typeof name !== "string" || name.length > 255) {
        issues.push({
            path: "name",
            message:
                typeof name !== "string"
                    ? "The name field is required."
                    : "The name field must not be greater than 255 characters.",
        });
    }

    let abilities: readonly ApiAbility[] | readonly ["*"] = ["*"];
    if (
        !Array.isArray(rawAbilities) ||
        rawAbilities.length === 0 ||
        !rawAbilities.every((ability) => typeof ability === "string")
    ) {
        issues.push({
            path: "abilities",
            message: "The abilities field must be a non-empty array of strings.",
        });
    } else if (rawAbilities.includes("*") && rawAbilities.length !== 1) {
        issues.push({
            path: "abilities",
            message: "The wildcard ability must be supplied by itself.",
        });
    } else if (
        !rawAbilities.every(
            (ability) => ability === "*" || apiAbilities.includes(ability as ApiAbility),
        )
    ) {
        issues.push({
            path: "abilities",
            message: "The abilities field contains an unsupported ability.",
        });
    } else {
        abilities = [...new Set(rawAbilities)] as
            | readonly ApiAbility[]
            | readonly ["*"];
    }

    let expiresAt: Date | null = null;
    if (rawExpiration !== null) {
        if (typeof rawExpiration !== "string") {
            issues.push({
                path: "expires_at",
                message: "The expires_at field must be a valid date.",
            });
        } else {
            expiresAt = new Date(rawExpiration);
            if (Number.isNaN(expiresAt.getTime())) {
                issues.push({
                    path: "expires_at",
                    message: "The expires_at field must be a valid date.",
                });
                expiresAt = null;
            } else if (expiresAt.getTime() <= now.getTime()) {
                issues.push({
                    path: "expires_at",
                    message: "The expires_at field must be a date after now.",
                });
            }
        }
    }

    if (issues.length > 0) {
        throw new ApiValidationError(issues);
    }

    return { name: name as string, abilities, expiresAt };
};
