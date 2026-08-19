import type { RequestContext } from "@/server/context/request-context";
import type { Ulid } from "@/server/ids";

export const mediaModelTypes = ["company", "people", "opportunity", "task", "note", "user", "team"] as const;
export type MediaModelType = (typeof mediaModelTypes)[number];

export type MediaRecord = Readonly<{
    id: bigint;
    uuid: string;
    modelType: MediaModelType;
    modelId: Ulid;
    collectionName: string;
    name: string;
    fileName: string;
    mimeType: string;
    disk: string;
    size: bigint;
    createdAt: Date | null;
}>;

export type MediaUpload = Readonly<{
    modelType: MediaModelType;
    modelId: Ulid;
    collectionName: string;
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
    imagesOnly?: boolean;
}>;

export interface MediaRepository {
    ownsModel(context: RequestContext, modelType: MediaModelType, modelId: Ulid): Promise<boolean>;
    insert(input: Omit<MediaRecord, "id" | "createdAt"> & Readonly<{ storageKey: string }>): Promise<MediaRecord>;
    find(uuid: string): Promise<(MediaRecord & Readonly<{ storageKey: string }>) | undefined>;
    isReferenced(uuid: string): Promise<boolean>;
    delete(id: bigint): Promise<void>;
    replaceCollection(modelType: MediaModelType, modelId: Ulid, collectionName: string, exceptUuid: string): Promise<readonly (MediaRecord & Readonly<{ storageKey: string }>)[]>;
    move(uuid: string, modelType: MediaModelType, modelId: Ulid): Promise<void>;
}

export interface MediaFileStorage {
    write(key: string, bytes: Uint8Array): Promise<void>;
    read(key: string): Promise<Uint8Array>;
    delete(key: string): Promise<void>;
}

export class MediaValidationError extends Error {
    public constructor(public readonly path: string, message: string) {
        super(message);
        this.name = "MediaValidationError";
    }
}
