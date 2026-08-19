import { basename } from "node:path";

import { ApiValidationError, jsonResponse } from "@/server/api/errors";
import type { ApiAccessResolver } from "@/server/api/http";
import { handleAuthenticatedApiRequest } from "@/server/api/http";
import { ulidSchema } from "@/server/ids";

import { MAX_CSV_BYTES } from "./csv";
import { exportJobStatus, CsvJobService } from "./service";
import type { CsvResource, ExportJob, ImportJob } from "./types";

export type CsvApiDependencies = Readonly<{ auth: ApiAccessResolver; jobs: CsvJobService }>;

const exportDocument = (job: ExportJob) => ({
    id: job.id, resource: job.resource, status: exportJobStatus(job),
    file_name: job.fileName, total_rows: job.totalRows,
    processed_rows: job.processedRows, successful_rows: job.successfulRows,
    completed_at: job.completedAt?.toISOString() ?? null,
    created_at: job.createdAt?.toISOString() ?? null,
    download_url: job.fileName === null ? null : `/api/v1/${job.resource}/exports/${job.id}/download`,
});

const importDocument = (job: ImportJob) => ({
    id: job.id, resource: job.resource, status: job.status, file_name: job.fileName,
    headers: job.headers, total_rows: job.totalRows, created_rows: job.createdRows,
    updated_rows: job.updatedRows, skipped_rows: job.skippedRows, failed_rows: job.failedRows,
    completed_at: job.completedAt?.toISOString() ?? null,
    created_at: job.createdAt?.toISOString() ?? null,
});

const jobIdFrom = (value: string) => {
    const parsed = ulidSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
};

const uploadError = (message: string): ApiValidationError =>
    new ApiValidationError([{ path: "file", message }]);

const uploadedCsv = async (request: Request): Promise<Readonly<{ fileName: string; contents: string }>> => {
    let bytes: Uint8Array;
    let fileName: string;
    if (request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data") === true) {
        const data = await request.formData();
        const file = data.get("file");
        if (!(file instanceof Blob)) {
            throw uploadError("The file field must contain a CSV upload.");
        }
        if (file.size > MAX_CSV_BYTES) {
            throw uploadError("The CSV file must not be larger than 10 MB.");
        }
        bytes = new Uint8Array(await file.arrayBuffer());
        fileName = "name" in file && typeof file.name === "string" ? basename(file.name) : "import.csv";
    } else {
        const length = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(length) && length > MAX_CSV_BYTES) {
            throw uploadError("The CSV file must not be larger than 10 MB.");
        }
        bytes = new Uint8Array(await request.arrayBuffer());
        fileName = basename(request.headers.get("x-file-name") ?? "import.csv");
    }
    if (bytes.byteLength > MAX_CSV_BYTES) throw uploadError("The CSV file must not be larger than 10 MB.");
    if (!fileName.toLowerCase().endsWith(".csv")) throw uploadError("The uploaded file must use the .csv extension.");
    try {
        return { fileName, contents: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {
        throw uploadError("The CSV file must be valid UTF-8 text.");
    }
};

export const handleExportCollectionRequest = (request: Request, resource: CsvResource, dependencies: CsvApiDependencies): Promise<Response> =>
    handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
        if (request.method !== "POST") return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
        return jsonResponse({ data: exportDocument(await dependencies.jobs.createExport(context, resource)) }, 201, requestId);
    }, "read");

export const handleExportRequest = (request: Request, resource: CsvResource, jobId: string, dependencies: CsvApiDependencies): Promise<Response> =>
    handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
        const id = jobIdFrom(jobId);
        if (request.method !== "GET") return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
        if (id === undefined) return jsonResponse({ message: "Not Found" }, 404, requestId);
        return jsonResponse({ data: exportDocument(await dependencies.jobs.exportStatus(context.teamId, resource, id)) }, 200, requestId);
    });

export const handleExportDownloadRequest = (request: Request, resource: CsvResource, jobId: string, dependencies: CsvApiDependencies): Promise<Response> =>
    handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
        const id = jobIdFrom(jobId);
        if (request.method !== "GET") return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
        if (id === undefined) return jsonResponse({ message: "Not Found" }, 404, requestId);
        const download = await dependencies.jobs.downloadExport(context.teamId, resource, id);
        return new Response(Buffer.from(download.bytes), { status: 200, headers: {
            "cache-control": "private, no-store", "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${download.fileName}"`, "x-request-id": requestId,
        } });
    });

export const handleImportCollectionRequest = (request: Request, resource: CsvResource, dependencies: CsvApiDependencies): Promise<Response> =>
    handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
        if (request.method === "GET") {
            return jsonResponse({ data: (await dependencies.jobs.listImports(context.teamId, resource)).map(importDocument) }, 200, requestId);
        }
        if (request.method === "POST") {
            const upload = await uploadedCsv(request);
            return jsonResponse({ data: importDocument(await dependencies.jobs.createImport(context, resource, upload.fileName, upload.contents)) }, 201, requestId);
        }
        return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
    });

export const handleImportRequest = (request: Request, resource: CsvResource, jobId: string, dependencies: CsvApiDependencies): Promise<Response> =>
    handleAuthenticatedApiRequest(request, dependencies.auth, async ({ context }, requestId) => {
        const id = jobIdFrom(jobId);
        if (request.method !== "GET") return jsonResponse({ message: "Method Not Allowed" }, 405, requestId);
        if (id === undefined) return jsonResponse({ message: "Not Found" }, 404, requestId);
        const result = await dependencies.jobs.importStatus(context.teamId, resource, id);
        return jsonResponse({ data: { ...importDocument(result.job), failed_rows: result.failedRows.map((failed) => ({
            id: failed.id, row: failed.row, error: failed.error, created_at: failed.createdAt?.toISOString() ?? null,
        })) } }, 200, requestId);
    });
