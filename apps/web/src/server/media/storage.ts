import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { MediaFileStorage } from "./types";

const SAFE_KEY = /^[a-f0-9]{2}\/[a-f0-9-]{36}$/u;

export class LocalMediaFileStorage implements MediaFileStorage {
    private readonly root: string;

    public constructor(root = path.join(process.cwd(), "storage", "app", "media")) {
        this.root = path.resolve(root);
    }

    public async write(key: string, bytes: Uint8Array): Promise<void> {
        const target = this.pathFor(key);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            const handle = await open(temporary, "wx", 0o600);
            try {
                await handle.writeFile(bytes);
                await handle.sync();
            } finally {
                await handle.close();
            }
            await rename(temporary, target);
        } finally {
            await rm(temporary, { force: true });
        }
    }

    public async read(key: string): Promise<Uint8Array> {
        const target = this.pathFor(key);
        const details = await lstat(target);
        if (!details.isFile() || details.isSymbolicLink()) throw new Error("Media storage entry is not a regular file.");
        return readFile(target);
    }

    public async delete(key: string): Promise<void> {
        await rm(this.pathFor(key), { force: true });
    }

    private pathFor(key: string): string {
        if (!SAFE_KEY.test(key)) throw new Error("Invalid media storage key.");
        const target = path.resolve(this.root, key);
        if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error("Media storage key escapes its configured root.");
        return target;
    }
}
