import path from "node:path";

import { MediaValidationError } from "./types";

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8192;
const MIME_TYPES = new Set([
    "application/json", "application/msword", "application/pdf", "application/rtf", "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip", "image/gif", "image/jpeg", "image/png", "image/webp", "image/x-icon", "text/csv", "text/plain",
]);
const IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp", "image/x-icon"]);

const dimensions = (bytes: Uint8Array, mime: string): readonly [number, number] | undefined => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (mime === "image/png" && bytes.length >= 24 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return [view.getUint32(16), view.getUint32(20)];
    if (mime === "image/gif" && bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(Buffer.from(bytes.subarray(0, 6)).toString("ascii"))) return [view.getUint16(6, true), view.getUint16(8, true)];
    if (mime === "image/webp" && bytes.length >= 30 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") {
        const kind = Buffer.from(bytes.subarray(12, 16)).toString("ascii");
        if (kind === "VP8X") return [1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16), 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16)];
        if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
        if (kind === "VP8L" && bytes[20] === 0x2f) return [1 + (bytes[21] ?? 0) + (((bytes[22] ?? 0) & 0x3f) << 8), 1 + ((bytes[22] ?? 0) >> 6) + ((bytes[23] ?? 0) << 2) + (((bytes[24] ?? 0) & 0x0f) << 10)];
    }
    if (mime === "image/jpeg" && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
        let offset = 2;
        while (offset + 8 < bytes.length) {
            if (bytes[offset] !== 0xff) { offset += 1; continue; }
            const marker = bytes[offset + 1] ?? 0;
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
            if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
            const length = view.getUint16(offset + 2);
            if (length < 2) break;
            offset += length + 2;
        }
    }
    if (mime === "image/x-icon" && bytes.length >= 8 && view.getUint16(0, true) === 0 && view.getUint16(2, true) === 1) return [bytes[6] || 256, bytes[7] || 256];
    return undefined;
};

export const validateMedia = (fileName: string, mimeType: string, bytes: Uint8Array, imagesOnly = false): { fileName: string; mimeType: string } => {
    const mime = mimeType.toLowerCase().split(";", 1)[0]?.trim() ?? "";
    const cleanName = path.basename(fileName).replace(/[\u0000-\u001f\u007f]/gu, "").trim();
    if (cleanName === "" || cleanName === "." || cleanName.length > 255) throw new MediaValidationError("file", "The file name is invalid.");
    if (bytes.length === 0) throw new MediaValidationError("file", "The file is empty.");
    if (bytes.length > MAX_MEDIA_BYTES) throw new MediaValidationError("file", "The file may not be larger than 10 MB.");
    if (!MIME_TYPES.has(mime) || (imagesOnly && !IMAGE_TYPES.has(mime))) throw new MediaValidationError("file", imagesOnly ? "The file must be a supported image." : "The file type is not supported.");
    if (IMAGE_TYPES.has(mime)) {
        if (bytes.length > MAX_IMAGE_BYTES) throw new MediaValidationError("file", "Images may not be larger than 5 MB.");
        const size = dimensions(bytes, mime);
        if (size === undefined) throw new MediaValidationError("file", "The image contents do not match its MIME type.");
        if (size[0] < 1 || size[1] < 1 || size[0] > MAX_IMAGE_DIMENSION || size[1] > MAX_IMAGE_DIMENSION) throw new MediaValidationError("file", "The image dimensions are invalid.");
    }
    return { fileName: cleanName, mimeType: mime };
};
