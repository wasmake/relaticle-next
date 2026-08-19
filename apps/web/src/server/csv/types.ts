import type { RequestContext } from "@/server/context/request-context";
import type {
    CustomFieldDefinition,
    CustomFieldsApiObject,
} from "@/server/custom-fields/types";
import type { Ulid } from "@/server/ids";

export const csvResources = [
    "companies",
    "people",
    "opportunities",
    "tasks",
    "notes",
] as const;

export type CsvResource = (typeof csvResources)[number];
export type CsvJobStatus = "queued" | "processing" | "completed" | "failed";
export type CsvRow = Readonly<Record<string, string>>;

export type CsvExportRecord = Readonly<{
    id: Ulid;
    values: Readonly<Record<string, string>>;
    customFields: CustomFieldsApiObject;
}>;

export type ExportJob = Readonly<{
    id: Ulid;
    teamId: Ulid;
    resource: CsvResource;
    fileName: string | null;
    totalRows: number;
    processedRows: number;
    successfulRows: number;
    completedAt: Date | null;
    createdAt: Date | null;
}>;

export type ImportJob = Readonly<{
    id: Ulid;
    teamId: Ulid;
    resource: CsvResource;
    fileName: string;
    status: CsvJobStatus;
    headers: readonly string[];
    totalRows: number;
    createdRows: number;
    updatedRows: number;
    skippedRows: number;
    failedRows: number;
    completedAt: Date | null;
    createdAt: Date | null;
}>;

export type FailedImportRow = Readonly<{
    id: Ulid;
    row: CsvRow;
    error: string;
    createdAt: Date | null;
}>;

export interface CsvJobRepository {
    createExport(job: ExportJob, userId: Ulid): Promise<void>;
    findExport(teamId: Ulid, resource: CsvResource, id: Ulid): Promise<ExportJob | undefined>;
    completeExport(teamId: Ulid, id: Ulid, fileName: string | null, rowCount: number): Promise<void>;
    createImport(job: ImportJob, userId: Ulid): Promise<void>;
    findImport(teamId: Ulid, resource: CsvResource, id: Ulid): Promise<ImportJob | undefined>;
    listImports(teamId: Ulid, resource: CsvResource): Promise<readonly ImportJob[]>;
    markImportProcessing(teamId: Ulid, id: Ulid): Promise<void>;
    completeImport(
        teamId: Ulid,
        id: Ulid,
        result: Readonly<{ createdRows: number; updatedRows: number; failedRows: number; status: "completed" | "failed" }>,
    ): Promise<void>;
    addFailedImportRow(teamId: Ulid, importId: Ulid, row: CsvRow, error: string): Promise<void>;
    listFailedImportRows(teamId: Ulid, importId: Ulid): Promise<readonly FailedImportRow[]>;
}

export interface CsvEntityPort {
    customFieldDefinitions(teamId: Ulid, resource: CsvResource): Promise<readonly CustomFieldDefinition[]>;
    exportRecords(context: RequestContext, resource: CsvResource): Promise<readonly CsvExportRecord[]>;
    upsertRecord(
        context: RequestContext,
        resource: CsvResource,
        values: Readonly<Record<string, unknown>>,
    ): Promise<"created" | "updated">;
}

export interface CsvFileStorage {
    write(key: string, contents: Uint8Array | string): Promise<void>;
    read(key: string): Promise<Uint8Array>;
}
