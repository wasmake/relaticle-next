export type BillingConfiguration = Readonly<{
    appUrl: string;
    secretKey: string;
    webhookSecret: string;
    monthlyPriceId: string;
    yearlyPriceId: string;
    creditPackPriceId: string;
    creditPackCredits: number;
    trialDays: number;
}>;

const required = (name: string): string => {
    const value = process.env[name]?.trim();

    if (value === undefined || value === "") {
        throw new Error(`${name} is required for billing.`);
    }

    return value;
};

const positiveInteger = (name: string, fallback: number): number => {
    const value = process.env[name];

    if (value === undefined) return fallback;

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer.`);
    }

    return parsed;
};

export const getBillingConfiguration = (): BillingConfiguration => ({
    appUrl: process.env.APP_URL?.replace(/\/+$/gu, "") ?? "http://localhost:3000",
    secretKey: required("STRIPE_SECRET"),
    webhookSecret: required("STRIPE_WEBHOOK_SECRET"),
    monthlyPriceId: required("STRIPE_PRO_MONTHLY_PRICE_ID"),
    yearlyPriceId: required("STRIPE_PRO_YEARLY_PRICE_ID"),
    creditPackPriceId: required("STRIPE_CREDIT_PACK_PRICE_ID"),
    creditPackCredits: positiveInteger("STRIPE_CREDIT_PACK_CREDITS", 1000),
    trialDays: positiveInteger("STRIPE_PRO_TRIAL_DAYS", 14),
});

export const billingIsConfigured = (): boolean =>
    [
        "STRIPE_SECRET",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_PRO_MONTHLY_PRICE_ID",
        "STRIPE_PRO_YEARLY_PRICE_ID",
        "STRIPE_CREDIT_PACK_PRICE_ID",
    ].every((name) => Boolean(process.env[name]?.trim()));
