import { describe, expect, it } from "vitest";

import type { ApiAccessResult } from "@/server/api/access";
import { apiAccessFromHttpAuthResult, type ApiAccessResolver } from "@/server/api/http";
import type { HttpAuthResult } from "@/server/auth/http";
import type { RequestContext } from "@/server/context/request-context";
import { handleMediaCollectionRequest, handleMediaRequest } from "@/server/media/handler";
import { resolvePublicUrl } from "@/server/media/remote-image";
import { MediaService } from "@/server/media/service";
import type { MediaFileStorage, MediaRecord, MediaRepository } from "@/server/media/types";
import { MediaValidationError } from "@/server/media/types";
import { validateMedia } from "@/server/media/validation";
import { ulidSchema } from "@/server/ids";

const teamId = ulidSchema.parse("01J00000000000000000000001");
const companyId = ulidSchema.parse("01J00000000000000000000002");
const context: RequestContext = { requestId: "request", teamId, userId: teamId, credential: { kind: "session", sessionId: "session" } };
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1]);
const authentication: HttpAuthResult = { ok: true, context, user: { id: teamId, name: "Ada", email: "ada@example.test" }, team: { id: teamId, name: "Team", slug: "team", personalTeam: false } };

class StaticAuth implements ApiAccessResolver {
    public constructor(private readonly result: HttpAuthResult) {}
    public async resolve(): Promise<ApiAccessResult> { return apiAccessFromHttpAuthResult(this.result); }
}

class MemoryStorage implements MediaFileStorage {
    public readonly entries = new Map<string, Uint8Array>();
    public async write(key: string, bytes: Uint8Array) { this.entries.set(key, bytes); }
    public async read(key: string) { const bytes = this.entries.get(key); if (bytes === undefined) throw new Error("missing"); return bytes; }
    public async delete(key: string) { this.entries.delete(key); }
}

class MemoryRepository implements MediaRepository {
    public readonly records = new Map<string, MediaRecord & { storageKey: string }>();
    public insertFails = false;
    public readonly references = new Set<string>();
    public async ownsModel(candidateContext: RequestContext, _type: MediaRecord["modelType"], id: typeof companyId) { return candidateContext.teamId === teamId && id === companyId; }
    public async insert(input: Omit<MediaRecord, "id" | "createdAt"> & { storageKey: string }) {
        if (this.insertFails) throw new Error("database failed");
        const record = { ...input, id: BigInt(this.records.size + 1), createdAt: new Date() };
        this.records.set(record.uuid, record);
        return record;
    }
    public async find(uuid: string) { return this.records.get(uuid); }
    public async isReferenced(uuid: string) { return this.references.has(uuid); }
    public async delete(id: bigint) { for (const [uuid, record] of this.records) if (record.id === id) this.records.delete(uuid); }
    public async replaceCollection(type: MediaRecord["modelType"], id: typeof companyId, collection: string, except: string) { const removed = [...this.records.values()].filter((record) => record.modelType === type && record.modelId === id && record.collectionName === collection && record.uuid !== except); for (const record of removed) this.records.delete(record.uuid); return removed; }
    public async move(uuid: string, type: MediaRecord["modelType"], id: typeof companyId) { const record = this.records.get(uuid); if (record !== undefined) this.records.set(uuid, { ...record, modelType: type, modelId: id }); }
}

describe("media lifecycle", () => {
    it("requires authentication for multipart upload, download, and delete", async () => {
        const service = new MediaService(new MemoryRepository(), new MemoryStorage());
        const denied = new StaticAuth({ ok: false, failure: { reason: "credentials_missing", status: 401 } });
        const deniedResponse = await handleMediaCollectionRequest(new Request("https://crm.test/api/v1/media", { method: "POST" }), { auth: denied, media: service });
        expect(deniedResponse.status).toBe(401);

        const form = new FormData();
        form.set("model_type", "company");
        form.set("model_id", companyId);
        form.set("collection_name", "documents");
        form.set("file", new File(["hello"], "hello.txt", { type: "text/plain" }));
        const dependencies = { auth: new StaticAuth(authentication), media: service };
        const uploaded = await handleMediaCollectionRequest(new Request("https://crm.test/api/v1/media", { method: "POST", body: form, headers: { "sec-fetch-site": "same-origin" } }), dependencies);
        expect(uploaded.status).toBe(201);
        const uuid = ((await uploaded.json()) as { data: { id: string } }).data.id;
        const downloaded = await handleMediaRequest(new Request(`https://crm.test/api/v1/media/${uuid}`), uuid, dependencies);
        expect(await downloaded.text()).toBe("hello");
        const deleted = await handleMediaRequest(new Request(`https://crm.test/api/v1/media/${uuid}`, { method: "DELETE", headers: { "sec-fetch-site": "same-origin" } }), uuid, dependencies);
        expect(deleted.status).toBe(204);
    });

    it("writes collision-safe keys, downloads, replaces, and deletes owned media", async () => {
        const repository = new MemoryRepository();
        const storage = new MemoryStorage();
        const service = new MediaService(repository, storage);
        const input = { modelType: "company", modelId: companyId, collectionName: "logo", fileName: "../logo.png", mimeType: "image/png", bytes: png, imagesOnly: true } as const;
        const first = await service.upload(context, input);
        const second = await service.upload(context, input, true);
        expect(first.uuid).not.toBe(second.uuid);
        expect(repository.records.has(first.uuid)).toBe(false);
        expect((await service.download(context, second.uuid)).bytes).toEqual(png);
        await service.remove(context, second.uuid);
        expect(storage.entries.size).toBe(0);
    });

    it("removes a stored file when database insertion fails", async () => {
        const repository = new MemoryRepository();
        repository.insertFails = true;
        const storage = new MemoryStorage();
        const service = new MediaService(repository, storage);
        await expect(service.upload(context, { modelType: "company", modelId: companyId, collectionName: "files", fileName: "notes.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("hello") })).rejects.toThrow("database failed");
        expect(storage.entries.size).toBe(0);
    });

    it("does not expose a model belonging to another tenant", async () => {
        const service = new MediaService(new MemoryRepository(), new MemoryStorage());
        const otherContext = { ...context, teamId: ulidSchema.parse("01J00000000000000000000003") };
        await expect(service.upload(otherContext, { modelType: "company", modelId: companyId, collectionName: "files", fileName: "notes.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("hello") })).rejects.toThrow("Not Found");
    });

    it("refuses to delete media while a custom field references it", async () => {
        const repository = new MemoryRepository();
        const storage = new MemoryStorage();
        const service = new MediaService(repository, storage);
        const record = await service.upload(context, { modelType: "company", modelId: companyId, collectionName: "files", fileName: "notes.txt", mimeType: "text/plain", bytes: new TextEncoder().encode("hello") });
        repository.references.add(record.uuid);
        await expect(service.remove(context, record.uuid)).rejects.toThrow("still referenced");
        expect(repository.records.has(record.uuid)).toBe(true);
        expect(storage.entries.size).toBe(1);
    });

    it("rejects MIME-spoofed images and private remote addresses", async () => {
        expect(() => validateMedia("fake.png", "image/png", new TextEncoder().encode("not an image"), true)).toThrow(MediaValidationError);
        await expect(resolvePublicUrl("https://127.0.0.1/favicon.ico")).rejects.toThrow("public internet");
        await expect(resolvePublicUrl("http://example.com/favicon.ico")).rejects.toThrow("Only standard HTTPS");
    });
});
