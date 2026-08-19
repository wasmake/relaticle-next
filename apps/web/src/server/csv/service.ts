import { ApiNotFoundError, ApiValidationError } from "@/server/api/errors";
import type { RequestContext } from "@/server/context/request-context";
import { hasApiAbility } from "@/server/context/request-context";
import type {
    CustomFieldApiValue,
    CustomFieldDefinition,
} from "@/server/custom-fields/types";
import { createUlid, type Ulid } from "@/server/ids";
import {
    csvExportJobName,
    csvImportJobName,
    jobOptionsFor,
    type CsvJob,
} from "@queue/jobs";

import { parseCsv, serializeCsv } from "./csv";
import type {
    CsvEntityPort,
    CsvFileStorage,
    CsvJobRepository,
    CsvResource,
    CsvRow,
    ExportJob,
    FailedImportRow,
    ImportJob,
} from "./types";

const nativeColumns: Record<CsvResource, readonly string[]> = {
    companies: ["id", "name", "created_at", "updated_at"],
    people: ["id", "name", "company_id", "created_at", "updated_at"],
    opportunities: ["id", "name", "company_id", "contact_id", "created_at", "updated_at"],
    tasks: ["id", "title", "company_ids", "people_ids", "opportunity_ids", "assignee_ids", "created_at", "updated_at"],
    notes: ["id", "title", "company_ids", "people_ids", "opportunity_ids", "created_at", "updated_at"],
};

const writeColumns: Record<CsvResource, readonly string[]> = {
    companies: ["id", "name"],
    people: ["id", "name", "company_id"],
    opportunities: ["id", "name", "company_id", "contact_id"],
    tasks: ["id", "title", "company_ids", "people_ids", "opportunity_ids", "assignee_ids"],
    notes: ["id", "title", "company_ids", "people_ids", "opportunity_ids"],
};

const requiredColumn = (resource: CsvResource): "name" | "title" =>
    resource === "tasks" || resource === "notes" ? "title" : "name";

const customColumn = (code: string): string => `custom_fields.${code}`;
const exportKey = (teamId: Ulid, id: Ulid): string => `exports/${teamId}/${id}.csv`;
const importKey = (teamId: Ulid, id: Ulid): string => `imports/${teamId}/${id}.csv`;

const apiValueForCsv = (value: CustomFieldApiValue | undefined): string => {
    if (value === undefined || value === null) {
        return "";
    }
    if (Array.isArray(value)) {
        return JSON.stringify(value.map((item) => item.id));
    }
    if (typeof value === "object") {
        return "id" in value ? String(value.id) : JSON.stringify(value);
    }
    return String(value);
};

const parseJsonArray = (value: string, path: string): readonly unknown[] => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value) as unknown;
    } catch {
        throw new ApiValidationError([{ path, message: "must be a JSON array." }]);
    }
    if (!Array.isArray(parsed)) {
        throw new ApiValidationError([{ path, message: "must be a JSON array." }]);
    }
    return parsed;
};

const customValueFromCsv = (
    value: string,
    definition: CustomFieldDefinition,
): unknown => {
    if (value === "") {
        return null;
    }
    if (["checkbox", "toggle"].includes(definition.type)) {
        const normalized = value.toLowerCase();
        if (["true", "1", "yes"].includes(normalized)) return true;
        if (["false", "0", "no"].includes(normalized)) return false;
        return value;
    }
    if (["select", "radio", "toggle-buttons"].includes(definition.type)) {
        return definition.options.find((option) => option.id === value || option.label === value)?.id ?? value;
    }
    if (["email", "phone", "link", "tags-input", "checkbox-list", "multi-select", "record"].includes(definition.type)) {
        const values = parseJsonArray(value, customColumn(definition.code));
        if (["checkbox-list", "multi-select"].includes(definition.type)) {
            return values.map((item) => {
                const candidate = String(item);
                return definition.options.find((option) => option.id === candidate || option.label === candidate)?.id ?? candidate;
            });
        }
        return values;
    }
    return value;
};

const errorMessage = (error: unknown): string => {
    if (error instanceof ApiValidationError) {
        return error.issues.map(({ path, message }) => `${path}: ${message}`).join("; ");
    }
    if (error instanceof ApiNotFoundError) {
        return "The supplied id does not belong to this workspace.";
    }
    if (error instanceof Error) {
        return error.message.slice(0, 2_000);
    }
    return "The row could not be imported.";
};

export class CsvJobService {
    public constructor(
        private readonly repository: CsvJobRepository,
        private readonly entities: CsvEntityPort,
        private readonly storage: CsvFileStorage,
        private readonly now: () => Date = () => new Date(),
        private readonly createId: () => Ulid = createUlid,
        private readonly queue?: CsvJobQueue,
    ) {}

    public async createExport(context: RequestContext, resource: CsvResource): Promise<ExportJob> {
        const job: ExportJob = {
            id: this.createId(), teamId: context.teamId, resource, fileName: null,
            totalRows: 0, processedRows: 0, successfulRows: 0,
            completedAt: null, createdAt: this.now(),
        };
        await this.repository.createExport(job, context.userId);
        if (this.queue === undefined) await this.processExport(context, job.id);
        else await this.queue.add(csvExportJobName, csvQueueJob(context, job.id, resource), jobOptionsFor(csvExportJobName, job.id));
        return (await this.repository.findExport(context.teamId, resource, job.id)) ?? job;
    }

    public async processExport(context: RequestContext, id: Ulid): Promise<void> {
        const job = await this.requireExport(context.teamId, id);
        try {
            const [definitions, records] = await Promise.all([
                this.entities.customFieldDefinitions(context.teamId, job.resource),
                this.entities.exportRecords(context, job.resource),
            ]);
            const headers = [...nativeColumns[job.resource], ...definitions.map(({ code }) => customColumn(code))];
            const rows = records.map((record) => ({
                ...record.values,
                ...Object.fromEntries(definitions.map(({ code }) => [customColumn(code), apiValueForCsv(record.customFields[code])])),
            }));
            const fileName = `${job.resource}-${job.id}.csv`;
            await this.storage.write(exportKey(context.teamId, id), serializeCsv(headers, rows));
            await this.repository.completeExport(context.teamId, id, fileName, rows.length);
        } catch (error) {
            await this.repository.completeExport(context.teamId, id, null, 0);
            throw error;
        }
    }

    public async exportStatus(teamId: Ulid, resource: CsvResource, id: Ulid): Promise<ExportJob> {
        const job = await this.repository.findExport(teamId, resource, id);
        if (job === undefined) throw new ApiNotFoundError();
        return job;
    }

    public async downloadExport(teamId: Ulid, resource: CsvResource, id: Ulid): Promise<Readonly<{ bytes: Uint8Array; fileName: string }>> {
        const job = await this.exportStatus(teamId, resource, id);
        if (job.completedAt === null || job.fileName === null) throw new ApiNotFoundError();
        return { bytes: await this.storage.read(exportKey(teamId, id)), fileName: job.fileName };
    }

    public async createImport(context: RequestContext, resource: CsvResource, fileName: string, contents: string): Promise<ImportJob> {
        const parsed = parseCsv(contents);
        if (parsed.rows.some((row) => (row.id ?? "") !== "") && !hasApiAbility(context, "update")) {
            throw new ApiValidationError([{ path: "file.id", message: "Updating existing records requires the update ability." }]);
        }
        await this.validateHeaders(context.teamId, resource, parsed.headers);
        const id = this.createId();
        const now = this.now();
        const job: ImportJob = {
            id, teamId: context.teamId, resource, fileName, status: "queued",
            headers: parsed.headers, totalRows: parsed.rows.length,
            createdRows: 0, updatedRows: 0, skippedRows: 0, failedRows: 0,
            completedAt: null, createdAt: now,
        };
        await this.storage.write(importKey(context.teamId, id), contents);
        await this.repository.createImport(job, context.userId);
        if (this.queue === undefined) await this.processImport(context, id);
        else await this.queue.add(csvImportJobName, csvQueueJob(context, id, resource), jobOptionsFor(csvImportJobName, id));
        return (await this.repository.findImport(context.teamId, resource, id)) ?? job;
    }

    public async processImport(context: RequestContext, id: Ulid): Promise<void> {
        const job = await this.requireImport(context.teamId, id);
        if (job.status === "completed") return;
        await this.repository.markImportProcessing(context.teamId, id);
        let createdRows = 0;
        let updatedRows = 0;
        let failedRows = 0;
        try {
            const contents = new TextDecoder("utf-8", { fatal: true }).decode(await this.storage.read(importKey(context.teamId, id)));
            const parsed = parseCsv(contents);
            const definitions = await this.validateHeaders(context.teamId, job.resource, parsed.headers);
            for (const row of parsed.rows) {
                try {
                    const result = await this.entities.upsertRecord(context, job.resource, this.valuesFromRow(job.resource, row, definitions));
                    if (result === "created") createdRows += 1;
                    else updatedRows += 1;
                } catch (error) {
                    failedRows += 1;
                    await this.repository.addFailedImportRow(context.teamId, id, row, errorMessage(error));
                }
            }
            await this.repository.completeImport(context.teamId, id, { createdRows, updatedRows, failedRows, status: "completed" });
        } catch (error) {
            await this.repository.completeImport(context.teamId, id, { createdRows, updatedRows, failedRows, status: "failed" });
            throw error;
        }
    }

    public async importStatus(teamId: Ulid, resource: CsvResource, id: Ulid): Promise<Readonly<{ job: ImportJob; failedRows: readonly FailedImportRow[] }>> {
        const job = await this.repository.findImport(teamId, resource, id);
        if (job === undefined) throw new ApiNotFoundError();
        return { job, failedRows: await this.repository.listFailedImportRows(teamId, id) };
    }

    public listImports(teamId: Ulid, resource: CsvResource): Promise<readonly ImportJob[]> {
        return this.repository.listImports(teamId, resource);
    }

    private async requireExport(teamId: Ulid, id: Ulid): Promise<ExportJob> {
        for (const resource of Object.keys(nativeColumns) as CsvResource[]) {
            const job = await this.repository.findExport(teamId, resource, id);
            if (job !== undefined) return job;
        }
        throw new ApiNotFoundError();
    }

    private async requireImport(teamId: Ulid, id: Ulid): Promise<ImportJob> {
        for (const resource of Object.keys(nativeColumns) as CsvResource[]) {
            const job = await this.repository.findImport(teamId, resource, id);
            if (job !== undefined) return job;
        }
        throw new ApiNotFoundError();
    }

    private async validateHeaders(teamId: Ulid, resource: CsvResource, headers: readonly string[]): Promise<readonly CustomFieldDefinition[]> {
        const definitions = await this.entities.customFieldDefinitions(teamId, resource);
        const allowed = new Set([...nativeColumns[resource], ...definitions.map(({ code }) => customColumn(code))]);
        const unknown = headers.filter((header) => !allowed.has(header));
        if (unknown.length > 0) {
            throw new ApiValidationError([{ path: "file.headers", message: `Unknown columns: ${unknown.join(", ")}.` }]);
        }
        if (!headers.includes(requiredColumn(resource))) {
            throw new ApiValidationError([{ path: "file.headers", message: `The ${requiredColumn(resource)} column is required.` }]);
        }
        return definitions;
    }

    private valuesFromRow(resource: CsvResource, row: CsvRow, definitions: readonly CustomFieldDefinition[]): Readonly<Record<string, unknown>> {
        const values: Record<string, unknown> = {};
        for (const column of writeColumns[resource]) {
            if (!Object.hasOwn(row, column)) continue;
            const value = row[column] ?? "";
            if (["company_ids", "people_ids", "opportunity_ids", "assignee_ids"].includes(column)) {
                values[column] = value === "" ? [] : parseJsonArray(value, column);
            } else if (["company_id", "contact_id"].includes(column)) {
                values[column] = value === "" ? null : value;
            } else {
                values[column] = value;
            }
        }
        const customFields = Object.fromEntries(definitions
            .filter(({ code }) => Object.hasOwn(row, customColumn(code)))
            .map((definition) => [definition.code, customValueFromCsv(row[customColumn(definition.code)] ?? "", definition)]));
        if (Object.keys(customFields).length > 0) values.custom_fields = customFields;
        return values;
    }
}

export interface CsvJobQueue {
    add(name: typeof csvExportJobName | typeof csvImportJobName, data: CsvJob, options: ReturnType<typeof jobOptionsFor>): Promise<unknown>;
}

const csvQueueJob = (context: RequestContext, jobId: Ulid, resource: CsvResource): CsvJob => ({
    version: 1,
    jobId,
    resource,
    context: {
        requestId: context.requestId,
        teamId: context.teamId,
        userId: context.userId,
        abilities: context.credential.kind === "personal_access_token"
            ? context.credential.abilities
            : ["read", "create", "update", "delete"],
    },
});

export const exportJobStatus = (job: ExportJob): "queued" | "completed" | "failed" =>
    job.completedAt === null ? "queued" : job.fileName === null ? "failed" : "completed";
