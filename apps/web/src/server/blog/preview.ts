import { createHmac, timingSafeEqual } from "node:crypto";

type PreviewPayload = Readonly<{ slug: string; expires: number }>;

const secret = (): string | undefined =>
    process.env.BLOG_PREVIEW_SECRET ?? process.env.APP_KEY;

const signature = (payload: string, key: string): string =>
    createHmac("sha256", key).update(payload).digest("base64url");

export const createPreviewToken = (
    slug: string,
    expires: number,
    key = secret(),
): string => {
    if (key === undefined || key.length < 16) {
        throw new Error("BLOG_PREVIEW_SECRET or APP_KEY must be at least 16 characters.");
    }

    const payload = Buffer.from(JSON.stringify({ slug, expires })).toString(
        "base64url",
    );

    return `${payload}.${signature(payload, key)}`;
};

export const verifyPreviewToken = (
    token: string,
    slug: string,
    now = Date.now(),
    key = secret(),
): boolean => {
    if (key === undefined || key.length < 16) {
        return false;
    }

    const [encoded, supplied, extra] = token.split(".");
    if (encoded === undefined || supplied === undefined || extra !== undefined) {
        return false;
    }

    const expected = signature(encoded, key);
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (
        suppliedBuffer.length !== expectedBuffer.length ||
        !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
        return false;
    }

    try {
        const payload = JSON.parse(
            Buffer.from(encoded, "base64url").toString("utf8"),
        ) as Partial<PreviewPayload>;

        return (
            payload.slug === slug &&
            typeof payload.expires === "number" &&
            payload.expires * 1000 > now
        );
    } catch {
        return false;
    }
};
