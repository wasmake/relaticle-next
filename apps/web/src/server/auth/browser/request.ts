import { getEnvironment } from "@/server/env";

export const hasSameOrigin = (
    request: Request,
    applicationUrl = getEnvironment().APP_URL,
): boolean => {
    const origin = request.headers.get("origin");

    if (origin === null) {
        return false;
    }

    try {
        const parsedOrigin = new URL(origin).origin;

        return [request.url, applicationUrl].some(
            (url) => parsedOrigin === new URL(url).origin,
        );
    } catch {
        return false;
    }
};

export const rejectCrossOrigin = (request: Request): Response | undefined =>
    hasSameOrigin(request)
        ? undefined
        : new Response("Invalid request origin.", { status: 403 });

export const textFormValue = (formData: FormData, name: string): string => {
    const value = formData.get(name);

    return typeof value === "string" ? value.trim() : "";
};

export const formValue = (formData: FormData, name: string): string => {
    const value = formData.get(name);

    return typeof value === "string" ? value : "";
};
