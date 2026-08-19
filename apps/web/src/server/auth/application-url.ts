import { getEnvironment, type Environment } from "@/server/env";

export const applicationUrl = (
    path: string,
    environment: Environment = getEnvironment(),
): URL => {
    const base = new URL(environment.APP_URL);
    base.pathname = "/";
    base.search = "";
    base.hash = "";
    return new URL(path.replace(/^\/+/, ""), base);
};
