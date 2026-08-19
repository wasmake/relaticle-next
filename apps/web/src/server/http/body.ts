export const DEFAULT_BODY_LIMIT = 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
    public constructor() {
        super("Request body is too large.");
        this.name = "RequestBodyTooLargeError";
    }
}

export const readBoundedBody = async (request: Request, limit = DEFAULT_BODY_LIMIT): Promise<Uint8Array> => {
    const declared = request.headers.get("content-length");
    if (declared !== null && Number(declared) > limit) throw new RequestBodyTooLargeError();
    if (request.body === null) return new Uint8Array();

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > limit) {
            await reader.cancel();
            throw new RequestBodyTooLargeError();
        }
        chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body;
};

export const readBoundedText = async (request: Request, limit = DEFAULT_BODY_LIMIT): Promise<string> =>
    new TextDecoder().decode(await readBoundedBody(request, limit));

export const parseBoundedJsonObject = async (request: Request, limit = DEFAULT_BODY_LIMIT): Promise<Record<string, unknown>> => {
    const value: unknown = JSON.parse(await readBoundedText(request, limit));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("The request body must be an object.");
    return value as Record<string, unknown>;
};

export const parseBoundedFormData = async (request: Request, limit = DEFAULT_BODY_LIMIT): Promise<FormData> => {
    const contentType = request.headers.get("content-type");
    if (contentType === null) throw new Error("A form request is required.");
    const bytes = await readBoundedBody(request, limit);
    return new Response(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { headers: { "content-type": contentType } }).formData();
};
