import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { MediaValidationError } from "./types";
import { MAX_IMAGE_BYTES, validateMedia } from "./validation";

const isPrivateAddress = (input: string): boolean => {
    const address = input.toLowerCase().replace(/^::ffff:/u, "");
    if (isIP(address) === 4) {
        const parts = address.split(".").map(Number);
        const [a = 0, b = 0] = parts;
        return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
    }
    return address === "::" || address === "::1" || address.startsWith("fc") || address.startsWith("fd") || /^fe[89ab]/u.test(address) || address.startsWith("ff");
};

export const resolvePublicUrl = async (value: string): Promise<{ url: URL; address: string; family: 4 | 6 }> => {
    let url: URL;
    try { url = new URL(value); } catch { throw new MediaValidationError("url", "A valid HTTPS URL is required."); }
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") throw new MediaValidationError("url", "Only standard HTTPS URLs without credentials are allowed.");
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) throw new MediaValidationError("url", "The URL must resolve only to public internet addresses.");
    const selected = addresses[0];
    if (selected === undefined || (selected.family !== 4 && selected.family !== 6)) throw new MediaValidationError("url", "The URL could not be resolved.");
    return { url, address: selected.address, family: selected.family };
};

const readResponse = async (target: Awaited<ReturnType<typeof resolvePublicUrl>>, signal?: AbortSignal): Promise<{ bytes: Uint8Array; contentType: string; redirect?: string }> => new Promise((resolve, reject) => {
    const transport = target.url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(target.url, {
        method: "GET", headers: { accept: "image/png,image/jpeg,image/webp,image/gif,image/x-icon", "user-agent": "Relaticle-Media/1.0" },
        lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
    }, (response) => {
        const status = response.statusCode ?? 500;
        if ([301, 302, 303, 307, 308].includes(status)) {
            response.resume();
            const location = response.headers.location;
            if (location === undefined) reject(new MediaValidationError("url", "The remote image returned an invalid redirect."));
            else resolve({ bytes: new Uint8Array(), contentType: "", redirect: location });
            return;
        }
        if (status < 200 || status >= 300) { response.resume(); reject(new MediaValidationError("url", "The remote image request failed.")); return; }
        const declared = Number(response.headers["content-length"]);
        if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) { response.destroy(); reject(new MediaValidationError("url", "The remote image is too large.")); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_IMAGE_BYTES) response.destroy(new MediaValidationError("url", "The remote image is too large.")); else chunks.push(chunk); });
        response.on("end", () => resolve({ bytes: Buffer.concat(chunks), contentType: String(response.headers["content-type"] ?? "") }));
        response.on("error", reject);
    });
    request.setTimeout(5_000, () => request.destroy(new MediaValidationError("url", "The remote image request timed out.")));
    const abort = (): void => { request.destroy(signal?.reason instanceof Error ? signal.reason : new Error("Remote image request aborted.")); };
    if (signal?.aborted === true) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    request.once("close", () => signal?.removeEventListener("abort", abort));
    request.on("error", reject);
    request.end();
});

export const fetchRemoteImage = async (input: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string }> => {
    let current = input;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
        const target = await resolvePublicUrl(current);
        const result = await readResponse(target, signal);
        if (result.redirect !== undefined) { current = new URL(result.redirect, target.url).toString(); continue; }
        const fileName = target.url.pathname.split("/").filter(Boolean).at(-1) ?? "favicon";
        const validated = validateMedia(fileName, result.contentType, result.bytes, true);
        return { bytes: result.bytes, mimeType: validated.mimeType, fileName: validated.fileName };
    }
    throw new MediaValidationError("url", "The remote image redirected too many times.");
};
