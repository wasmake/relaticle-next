import { randomUUID } from "node:crypto";
import path from "node:path";

import { ApiNotFoundError } from "@/server/api/errors";
import type { RequestContext } from "@/server/context/request-context";

import type { MediaFileStorage, MediaRecord, MediaRepository, MediaUpload } from "./types";
import { MediaValidationError } from "./types";
import { validateMedia } from "./validation";

const SAFE_COLLECTION = /^[a-z][a-z0-9_-]{0,63}$/u;

export class MediaService {
    public constructor(private readonly repository: MediaRepository, private readonly storage: MediaFileStorage) {}

    public async upload(context: RequestContext, input: MediaUpload, replaceCollection = false): Promise<MediaRecord> {
        if (!SAFE_COLLECTION.test(input.collectionName)) throw new MediaValidationError("collection_name", "The collection name is invalid.");
        if (!await this.repository.ownsModel(context, input.modelType, input.modelId)) throw new ApiNotFoundError();
        const validated = validateMedia(input.fileName, input.mimeType, input.bytes, input.imagesOnly);
        const uuid = randomUUID();
        const storageKey = `${uuid.slice(0, 2)}/${uuid}`;
        await this.storage.write(storageKey, input.bytes);
        let created: MediaRecord | undefined;
        try {
            created = await this.repository.insert({
                uuid, modelType: input.modelType, modelId: input.modelId, collectionName: input.collectionName,
                name: path.parse(validated.fileName).name.slice(0, 255), fileName: validated.fileName,
                mimeType: validated.mimeType, disk: "local", size: BigInt(input.bytes.length), storageKey,
            });
            if (replaceCollection) {
                const removed = await this.repository.replaceCollection(input.modelType, input.modelId, input.collectionName, uuid);
                await Promise.all(removed.map(({ storageKey: key, uuid: removedUuid }) => this.storage.delete(key).catch((error) => console.error("Replaced media cleanup failed", { uuid: removedUuid, error }))));
            }
            return created;
        } catch (error) {
            if (created !== undefined) await this.repository.delete(created.id).catch(() => undefined);
            await this.storage.delete(storageKey);
            throw error;
        }
    }

    public async download(context: RequestContext, uuid: string): Promise<{ record: MediaRecord; bytes: Uint8Array }> {
        const record = await this.authorized(context, uuid);
        return { record, bytes: await this.storage.read(record.storageKey) };
    }

    public async remove(context: RequestContext, uuid: string): Promise<void> {
        const record = await this.authorized(context, uuid);
        if (await this.repository.isReferenced(uuid)) throw new MediaValidationError("media", "The file is still referenced by a custom field.");
        await this.repository.delete(record.id);
        try {
            await this.storage.delete(record.storageKey);
        } catch (error) {
            console.error("Media file cleanup failed", { uuid, error });
        }
    }

    public async move(context: RequestContext, uuid: string, modelType: MediaUpload["modelType"], modelId: MediaUpload["modelId"]): Promise<void> {
        await this.authorized(context, uuid);
        if (!await this.repository.ownsModel(context, modelType, modelId)) throw new ApiNotFoundError();
        await this.repository.move(uuid, modelType, modelId);
    }

    private async authorized(context: RequestContext, uuid: string) {
        const record = await this.repository.find(uuid);
        if (record === undefined || !await this.repository.ownsModel(context, record.modelType, record.modelId)) throw new ApiNotFoundError();
        return record;
    }
}
