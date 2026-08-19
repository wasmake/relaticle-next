export const hasSameOrigin = (request: Request): boolean => {
    const origin = request.headers.get("origin");

    if (origin === null) {
        return false;
    }

    try {
        return new URL(origin).origin === new URL(request.url).origin;
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
