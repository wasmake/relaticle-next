import { and, eq, ne, notExists } from "drizzle-orm";

import type { RequestContext } from "@/server/context/request-context";
import { getDatabase } from "@/server/db/client";
import { companies, customFields, customFieldValues, media, notes, opportunities, people, tasks } from "@/server/db/schema";
import type { JsonValue } from "@/server/db/schema/shared";
import type { Ulid } from "@/server/ids";

import type { MediaModelType, MediaRecord, MediaRepository } from "./types";

type Database = ReturnType<typeof getDatabase>;
const storageKeyFor = (properties: JsonValue): string => {
    if (typeof properties !== "object" || properties === null || Array.isArray(properties) || typeof properties.storage_key !== "string") throw new Error("Media record has no storage key.");
    return properties.storage_key;
};

const mapRecord = (row: typeof media.$inferSelect): MediaRecord & Readonly<{ storageKey: string }> => ({
    id: row.id,
    uuid: row.uuid ?? "",
    modelType: row.modelType as MediaModelType,
    modelId: row.modelId as Ulid,
    collectionName: row.collectionName,
    name: row.name,
    fileName: row.fileName,
    mimeType: row.mimeType ?? "application/octet-stream",
    disk: row.disk,
    size: row.size,
    createdAt: row.createdAt,
    storageKey: storageKeyFor(row.customProperties),
});

export class DrizzleMediaRepository implements MediaRepository {
    public constructor(private readonly database: Database = getDatabase()) {}

    public async ownsModel(context: RequestContext, modelType: MediaModelType, modelId: Ulid): Promise<boolean> {
        if (modelType === "user") return modelId === context.userId;
        if (modelType === "team") return modelId === context.teamId;
        const table = modelType === "company" ? companies : modelType === "people" ? people : modelType === "opportunity" ? opportunities : modelType === "task" ? tasks : notes;
        const [owned] = await this.database.select({ id: table.id }).from(table).where(and(eq(table.id, modelId), eq(table.teamId, context.teamId))).limit(1);
        return owned !== undefined;
    }

    public async insert(input: Omit<MediaRecord, "id" | "createdAt"> & Readonly<{ storageKey: string }>): Promise<MediaRecord> {
        const now = new Date();
        const [created] = await this.database.insert(media).values({
            modelType: input.modelType, modelId: input.modelId, uuid: input.uuid, collectionName: input.collectionName,
            name: input.name, fileName: input.fileName, mimeType: input.mimeType, disk: input.disk, size: input.size,
            manipulations: {}, customProperties: { storage_key: input.storageKey }, generatedConversions: {}, responsiveImages: [], createdAt: now, updatedAt: now,
        }).returning();
        if (created === undefined) throw new Error("Media record was not created.");
        return mapRecord(created);
    }

    public async find(uuid: string): Promise<(MediaRecord & Readonly<{ storageKey: string }>) | undefined> {
        const [record] = await this.database.select().from(media).where(eq(media.uuid, uuid)).limit(1);
        return record === undefined ? undefined : mapRecord(record);
    }

    public async isReferenced(uuid: string): Promise<boolean> {
        const [reference] = await this.database.select({ id: customFieldValues.id }).from(customFieldValues)
            .innerJoin(customFields, eq(customFields.id, customFieldValues.customFieldId))
            .where(and(eq(customFields.type, "file-upload"), eq(customFieldValues.stringValue, uuid))).limit(1);
        return reference !== undefined;
    }

    public async delete(id: bigint): Promise<void> {
        await this.database.delete(media).where(eq(media.id, id));
    }

    public async replaceCollection(modelType: MediaModelType, modelId: Ulid, collectionName: string, exceptUuid: string): Promise<readonly (MediaRecord & Readonly<{ storageKey: string }>)[]> {
        const referenced = this.database.select({ id: customFieldValues.id }).from(customFieldValues)
            .innerJoin(customFields, eq(customFields.id, customFieldValues.customFieldId))
            .where(and(eq(customFields.type, "file-upload"), eq(customFieldValues.stringValue, media.uuid)));
        const removed = await this.database.delete(media).where(and(eq(media.modelType, modelType), eq(media.modelId, modelId), eq(media.collectionName, collectionName), ne(media.uuid, exceptUuid), notExists(referenced))).returning();
        return removed.map(mapRecord);
    }

    public async move(uuid: string, modelType: MediaModelType, modelId: Ulid): Promise<void> {
        await this.database.update(media).set({ modelType, modelId, updatedAt: new Date() }).where(eq(media.uuid, uuid));
    }
}
