export type StripeObject = Readonly<Record<string, unknown> & { id: string }>;

type StripeFetch = typeof fetch;
type StripeParameter = string | number | boolean | null | undefined;

export class StripeRequestError extends Error {
    public constructor(
        message: string,
        public readonly status: number,
    ) {
        super(message);
        this.name = "StripeRequestError";
    }
}

const appendParameter = (
    form: URLSearchParams,
    name: string,
    value: StripeParameter | readonly StripeParameter[],
): void => {
    if (Array.isArray(value)) {
        value.forEach((item, index) => appendParameter(form, `${name}[${index}]`, item));
        return;
    }

    if (value !== undefined && value !== null) form.set(name, String(value));
};

export class StripeClient {
    public constructor(
        private readonly secretKey: string,
        private readonly stripeFetch: StripeFetch = fetch,
        private readonly apiUrl = "https://api.stripe.com/v1",
    ) {}

    public async create<T extends StripeObject>(
        path: string,
        parameters: Readonly<Record<string, StripeParameter | readonly StripeParameter[]>>,
        idempotencyKey?: string,
    ): Promise<T> {
        const form = new URLSearchParams();
        for (const [name, value] of Object.entries(parameters)) appendParameter(form, name, value);

        const init: RequestInit = {
            method: "POST",
            body: form,
        };
        if (idempotencyKey !== undefined) init.headers = { "Idempotency-Key": idempotencyKey };
        return this.request<T>(path, init);
    }

    public async retrieve<T extends StripeObject>(path: string): Promise<T> {
        return this.request<T>(path, { method: "GET" });
    }

    private async request<T extends StripeObject>(path: string, init: RequestInit): Promise<T> {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${this.secretKey}`);
        if (init.body !== undefined) headers.set("Content-Type", "application/x-www-form-urlencoded");

        const response = await this.stripeFetch(`${this.apiUrl}${path}`, { ...init, headers });
        const payload: unknown = await response.json().catch(() => undefined);

        if (!response.ok) {
            const error = payload as { error?: { message?: unknown } } | undefined;
            const message = typeof error?.error?.message === "string"
                ? error.error.message
                : `Stripe request failed with status ${response.status}.`;
            throw new StripeRequestError(message, response.status);
        }

        if (typeof payload !== "object" || payload === null || !("id" in payload)) {
            throw new StripeRequestError("Stripe returned an invalid response.", 502);
        }

        return payload as T;
    }
}
