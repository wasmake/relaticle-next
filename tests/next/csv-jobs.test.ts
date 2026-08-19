import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ApiValidationError } from "@/server/api/errors";
import { createRequestContext } from "@/server/context/request-context";
import { parseCsv, serializeCsv } from "@/server/csv/csv";
import { CsvJobService } from "@/server/csv/service";
import { LocalCsvFileStorage } from "@/server/csv/storage";
import type {
    CsvEntityPort,
    CsvFileStorage,
    CsvJobRepository,
    CsvResource,
    CsvRow,
    ExportJob,
    FailedImportRow,
    ImportJob,
} from "@/server/csv/types";
import type { CustomFieldDefinition } from "@/server/custom-fields/types";
import { ulidSchema, type Ulid } from "@/server/ids";

const ulid = (sequence: number): Ulid => ulidSchema.parse(`01J${sequence.toString().padStart(23, "0")}`);
const teamId = ulid(1);
const otherTeamId = ulid(2);
const userId = ulid(3);
const context = createRequestContext({
    requestId: "csv-test", teamId, userId,
    credential: { kind: "session", sessionId: "csv-session" },
});

class MemoryStorage implements CsvFileStorage {
    public readonly files = new Map<string, Uint8Array>();
    public async write(key: string, contents: Uint8Array | string) {
        this.files.set(key, typeof contents === "string" ? new TextEncoder().encode(contents) : contents);
    }
    public async read(key: string) {
        const value = this.files.get(key);
        if (value === undefined) throw new Error("missing file");
        return value;
    }
}

class MemoryJobs implements CsvJobRepository {
    public exports = new Map<Ulid, ExportJob>();
    public imports = new Map<Ulid, ImportJob>();
    public failed = new Map<Ulid, FailedImportRow[]>();
    public async createExport(job: ExportJob) { this.exports.set(job.id, job); }
    public async findExport(requestedTeamId: Ulid, resource: CsvResource, id: Ulid) {
        const job = this.exports.get(id);
        return job?.teamId === requestedTeamId && job.resource === resource ? job : undefined;
    }
    public async completeExport(requestedTeamId: Ulid, id: Ulid, fileName: string | null, rowCount: number) {
        const job = this.exports.get(id);
        if (job?.teamId === requestedTeamId) this.exports.set(id, { ...job, fileName, totalRows: rowCount, processedRows: rowCount, successfulRows: fileName === null ? 0 : rowCount, completedAt: new Date() });
    }
    public async createImport(job: ImportJob) { this.imports.set(job.id, job); }
    public async findImport(requestedTeamId: Ulid, resource: CsvResource, id: Ulid) {
        const job = this.imports.get(id);
        return job?.teamId === requestedTeamId && job.resource === resource ? job : undefined;
    }
    public async listImports(requestedTeamId: Ulid, resource: CsvResource) {
        return [...this.imports.values()].filter((job) => job.teamId === requestedTeamId && job.resource === resource);
    }
    public async markImportProcessing(requestedTeamId: Ulid, id: Ulid) {
        const job = this.imports.get(id);
        if (job?.teamId === requestedTeamId) this.imports.set(id, { ...job, status: "processing" });
    }
    public async completeImport(requestedTeamId: Ulid, id: Ulid, result: Parameters<CsvJobRepository["completeImport"]>[2]) {
        const job = this.imports.get(id);
        if (job?.teamId === requestedTeamId) this.imports.set(id, { ...job, ...result, completedAt: new Date() });
    }
    public async addFailedImportRow(requestedTeamId: Ulid, importId: Ulid, row: CsvRow, error: string) {
        const job = this.imports.get(importId);
        if (job?.teamId !== requestedTeamId) return;
        const records = this.failed.get(importId) ?? [];
        records.push({ id: ulid(90 + records.length), row, error, createdAt: new Date() });
        this.failed.set(importId, records);
    }
    public async listFailedImportRows(requestedTeamId: Ulid, importId: Ulid) {
        return this.imports.get(importId)?.teamId === requestedTeamId ? this.failed.get(importId) ?? [] : [];
    }
}

const roleDefinition: CustomFieldDefinition = {
    id: ulid(20), teamId, entityType: "company", code: "role", name: "Role",
    type: "text", lookupType: null, validationRules: {}, settings: {}, options: [],
};

class MemoryEntities implements CsvEntityPort {
    public readonly writes: Array<{ resource: CsvResource; values: Readonly<Record<string, unknown>> }> = [];
    public async customFieldDefinitions(requestedTeamId: Ulid, resource: CsvResource) {
        return requestedTeamId === teamId && resource === "companies" ? [roleDefinition] : [];
    }
    public async exportRecords(_context: typeof context, resource: CsvResource) {
        return [{ id: ulid(30), values: { id: ulid(30), [resource === "tasks" || resource === "notes" ? "title" : "name"]: "=Unsafe" }, customFields: resource === "companies" ? { role: "Lead" } : {} }];
    }
    public async upsertRecord(_context: typeof context, resource: CsvResource, values: Readonly<Record<string, unknown>>): Promise<"created"> {
        this.writes.push({ resource, values });
        if (values.name === "Bad" || values.title === "Bad") throw new ApiValidationError([{ path: "name", message: "invalid row" }]);
        return "created";
    }
}

describe("CSV parser and serializer", () => {
    it("handles BOM, CRLF, escaped quotes, commas, and multiline fields", () => {
        expect(parseCsv('\uFEFFname,detail\r\n"Ada, Inc.","line 1\nline ""2"""\r\n')).toEqual({
            headers: ["name", "detail"], rows: [{ name: "Ada, Inc.", detail: 'line 1\nline "2"' }],
        });
    });

    it("rejects duplicate headers and inconsistent rows", () => {
        expect(() => parseCsv("name,name\nA,B\n")).toThrow("unique");
        expect(() => parseCsv("name,detail\nA\n")).toThrow("expected 2");
        expect(() => parseCsv('name\n"Ada"suffix\n')).toThrow("closing quote");
    });

    it("quotes CSV cells and neutralizes spreadsheet formulas", () => {
        expect(serializeCsv(["name"], [{ name: '=HYPERLINK("bad")' }])).toBe('name\r\n"\'=HYPERLINK(""bad"")"\r\n');
    });
});

describe("local CSV storage", () => {
    const roots: string[] = [];
    afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

    it("writes atomically and rejects traversal keys", async () => {
        const root = await mkdtemp(path.join(tmpdir(), "crm-csv-"));
        roots.push(root);
        const storage = new LocalCsvFileStorage(root);
        await storage.write("exports/team/job.csv", "name\nAda\n");
        expect(new TextDecoder().decode(await storage.read("exports/team/job.csv"))).toBe("name\nAda\n");
        await expect(storage.write("../escape.csv", "bad")).rejects.toThrow("Invalid CSV storage key");
    });
});

describe("CSV jobs", () => {
    it.each([
        ["companies", "name"], ["people", "name"], ["opportunities", "name"],
        ["tasks", "title"], ["notes", "title"],
    ] as const)("imports valid %s rows", async (resource, required) => {
        const jobs = new MemoryJobs();
        const entities = new MemoryEntities();
        let sequence = 40;
        const service = new CsvJobService(jobs, entities, new MemoryStorage(), () => new Date("2026-08-19T00:00:00Z"), () => ulid(sequence++));
        const job = await service.createImport(context, resource, `${resource}.csv`, `${required}\nValid\n`);
        expect(job).toMatchObject({ resource, status: "completed", createdRows: 1, failedRows: 0 });
        expect(entities.writes).toEqual([{ resource, values: { [required]: "Valid" } }]);
    });

    it("exports custom fields, stores failed rows, and enforces tenant ownership", async () => {
        const jobs = new MemoryJobs();
        const storage = new MemoryStorage();
        const service = new CsvJobService(jobs, new MemoryEntities(), storage, undefined, () => ulid(60));
        const exported = await service.createExport(context, "companies");
        const download = await service.downloadExport(teamId, "companies", exported.id);
        expect(new TextDecoder().decode(download.bytes)).toContain("custom_fields.role");
        expect(new TextDecoder().decode(download.bytes)).toContain("'=Unsafe");
        await expect(service.exportStatus(otherTeamId, "companies", exported.id)).rejects.toThrow("Not Found");

        const imported = await service.createImport(context, "companies", "companies.csv", "name,custom_fields.role\nBad,Owner\n");
        const status = await service.importStatus(teamId, "companies", imported.id);
        expect(status.job).toMatchObject({ status: "completed", failedRows: 1 });
        expect(status.failedRows[0]?.error).toContain("invalid row");
    });
});
