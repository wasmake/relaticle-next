import { and, desc, eq } from "drizzle-orm";

import { getDatabase } from "@/server/db/client";
import { exports, failedImportRows, imports } from "@/server/db/schema";
import type { JsonValue } from "@/server/db/schema/shared";
import { createUlid, ulidSchema } from "@/server/ids";

import type {
    CsvJobRepository,
    CsvResource,
    CsvRow,
    ExportJob,
    FailedImportRow,
    ImportJob,
} from "./types";
import { csvResources } from "./types";

type Database = ReturnType<typeof getDatabase>;
const exporterFor = (resource: CsvResource): string => `node-csv:${resource}`;

const resourceFrom = (value: string | null): CsvResource | undefined =>
    csvResources.find((resource) => resource === value);

const exportFrom = (row: typeof exports.$inferSelect): ExportJob | undefined => {
    const resource = row.exporter.startsWith("node-csv:")
        ? resourceFrom(row.exporter.slice("node-csv:".length))
        : undefined;
    if (row.teamId === null || resource === undefined) return undefined;
    return {
        id: ulidSchema.parse(row.id), teamId: ulidSchema.parse(row.teamId), resource,
        fileName: row.fileName, totalRows: row.totalRows,
        processedRows: row.processedRows, successfulRows: row.successfulRows,
        completedAt: row.completedAt, createdAt: row.createdAt,
    };
};

const stringArray = (value: JsonValue | null): readonly string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const importFrom = (row: typeof imports.$inferSelect): ImportJob | undefined => {
    const resource = resourceFrom(row.entityType);
    const statuses = ["queued", "processing", "completed", "failed"] as const;
    const status = statuses.find((candidate) => candidate === row.status) ?? "failed";
    if (row.teamId === null || resource === undefined) return undefined;
    return {
        id: ulidSchema.parse(row.id), teamId: ulidSchema.parse(row.teamId), resource,
        fileName: row.fileName, status, headers: stringArray(row.headers),
        totalRows: row.totalRows, createdRows: row.createdRows,
        updatedRows: row.updatedRows, skippedRows: row.skippedRows,
        failedRows: row.failedRows, completedAt: row.completedAt, createdAt: row.createdAt,
    };
};

const jsonRow = (row: CsvRow): JsonValue => ({ ...row });

export class DrizzleCsvJobRepository implements CsvJobRepository {
    public constructor(private readonly database: Database = getDatabase()) {}

    public async createExport(job: ExportJob, userId: Parameters<CsvJobRepository["createExport"]>[1]): Promise<void> {
        await this.database.insert(exports).values({
            id: job.id, teamId: job.teamId, completedAt: null, fileDisk: "local-csv",
            fileName: null, exporter: exporterFor(job.resource), processedRows: 0,
            totalRows: 0, successfulRows: 0, userId,
            createdAt: job.createdAt, updatedAt: job.createdAt,
        });
    }

    public async findExport(teamId: Parameters<CsvJobRepository["findExport"]>[0], resource: CsvResource, id: Parameters<CsvJobRepository["findExport"]>[2]): Promise<ExportJob | undefined> {
        const [row] = await this.database.select().from(exports).where(and(
            eq(exports.id, id), eq(exports.teamId, teamId), eq(exports.exporter, exporterFor(resource)),
        )).limit(1);
        return row === undefined ? undefined : exportFrom(row);
    }

    public async completeExport(teamId: Parameters<CsvJobRepository["completeExport"]>[0], id: Parameters<CsvJobRepository["completeExport"]>[1], fileName: string | null, rowCount: number): Promise<void> {
        await this.database.update(exports).set({
            fileName, totalRows: rowCount, processedRows: rowCount,
            successfulRows: fileName === null ? 0 : rowCount,
            completedAt: new Date(), updatedAt: new Date(),
        }).where(and(eq(exports.id, id), eq(exports.teamId, teamId)));
    }

    public async createImport(job: ImportJob, userId: Parameters<CsvJobRepository["createImport"]>[1]): Promise<void> {
        await this.database.insert(imports).values({
            id: job.id, teamId: job.teamId, completedAt: null, fileName: job.fileName,
            totalRows: job.totalRows, userId, entityType: job.resource, status: "queued",
            headers: [...job.headers], columnMappings: {}, createdRows: 0,
            updatedRows: 0, skippedRows: 0, failedRows: 0,
            createdAt: job.createdAt, updatedAt: job.createdAt,
        });
    }

    public async findImport(teamId: Parameters<CsvJobRepository["findImport"]>[0], resource: CsvResource, id: Parameters<CsvJobRepository["findImport"]>[2]): Promise<ImportJob | undefined> {
        const [row] = await this.database.select().from(imports).where(and(
            eq(imports.id, id), eq(imports.teamId, teamId), eq(imports.entityType, resource),
        )).limit(1);
        return row === undefined ? undefined : importFrom(row);
    }

    public async listImports(teamId: Parameters<CsvJobRepository["listImports"]>[0], resource: CsvResource): Promise<readonly ImportJob[]> {
        const rows = await this.database.select().from(imports).where(and(
            eq(imports.teamId, teamId), eq(imports.entityType, resource),
        )).orderBy(desc(imports.createdAt)).limit(50);
        return rows.map(importFrom).filter((job): job is ImportJob => job !== undefined);
    }

    public async markImportProcessing(teamId: Parameters<CsvJobRepository["markImportProcessing"]>[0], id: Parameters<CsvJobRepository["markImportProcessing"]>[1]): Promise<void> {
        await this.database.update(imports).set({ status: "processing", updatedAt: new Date() })
            .where(and(eq(imports.id, id), eq(imports.teamId, teamId)));
    }

    public async completeImport(teamId: Parameters<CsvJobRepository["completeImport"]>[0], id: Parameters<CsvJobRepository["completeImport"]>[1], result: Parameters<CsvJobRepository["completeImport"]>[2]): Promise<void> {
        await this.database.update(imports).set({
            status: result.status, createdRows: result.createdRows,
            updatedRows: result.updatedRows, failedRows: result.failedRows,
            completedAt: new Date(), updatedAt: new Date(),
        }).where(and(eq(imports.id, id), eq(imports.teamId, teamId)));
    }

    public async addFailedImportRow(teamId: Parameters<CsvJobRepository["addFailedImportRow"]>[0], importId: Parameters<CsvJobRepository["addFailedImportRow"]>[1], row: CsvRow, error: string): Promise<void> {
        const now = new Date();
        await this.database.insert(failedImportRows).values({
            id: createUlid(), teamId, importId, data: jsonRow(row), validationError: error,
            createdAt: now, updatedAt: now,
        });
    }

    public async listFailedImportRows(teamId: Parameters<CsvJobRepository["listFailedImportRows"]>[0], importId: Parameters<CsvJobRepository["listFailedImportRows"]>[1]): Promise<readonly FailedImportRow[]> {
        const rows = await this.database.select().from(failedImportRows).where(and(
            eq(failedImportRows.teamId, teamId), eq(failedImportRows.importId, importId),
        )).orderBy(failedImportRows.createdAt);
        return rows.map((row) => ({
            id: ulidSchema.parse(row.id),
            row: typeof row.data === "object" && row.data !== null && !Array.isArray(row.data)
                ? Object.fromEntries(Object.entries(row.data).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]))
                : {},
            error: row.validationError ?? "The row could not be imported.", createdAt: row.createdAt,
        }));
    }
}
