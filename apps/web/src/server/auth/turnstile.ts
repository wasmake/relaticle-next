import { getEnvironment, type Environment } from "@/server/env";

type TurnstileResponse = Readonly<{ success?: boolean; hostname?: string }>;

export const verifyTurnstile = async (token: string, remoteIp?: string | null, request: typeof fetch = fetch, environment: Environment = getEnvironment()): Promise<boolean> => {
    const secret = environment.TURNSTILE_SECRET_KEY;
    if (secret === undefined) return true;
    if (token === "") return false;
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    try {
        const response = await request("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5_000) });
        if (!response.ok) return false;
        const result = await response.json() as TurnstileResponse;
        return result.success === true && result.hostname === new URL(environment.APP_URL).hostname;
    } catch {
        return false;
    }
};
