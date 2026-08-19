import { createHmac, timingSafeEqual } from "node:crypto";

export class StripeSignatureError extends Error {
    public constructor(message = "Invalid Stripe webhook signature.") {
        super(message);
        this.name = "StripeSignatureError";
    }
}

const safeEqual = (left: string, right: string): boolean => {
    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");

    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const stripeSignature = (payload: string, timestamp: number, secret: string): string =>
    createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");

export const verifyStripeSignature = (
    payload: string,
    header: string | null,
    secret: string,
    nowSeconds = Math.floor(Date.now() / 1000),
    toleranceSeconds = 300,
): void => {
    if (header === null) throw new StripeSignatureError();

    const values = header.split(",").map((part) => part.trim().split("=", 2) as [string, string?]);
    const timestampText = values.find(([key]) => key === "t")?.[1];
    const signatures = values.filter(([key, value]) => key === "v1" && value !== undefined).map(([, value]) => value as string);
    const timestamp = Number(timestampText);

    if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
        throw new StripeSignatureError();
    }

    const expected = stripeSignature(payload, timestamp, secret);
    if (signatures.length === 0 || !signatures.some((candidate) => safeEqual(candidate, expected))) {
        throw new StripeSignatureError();
    }
};
