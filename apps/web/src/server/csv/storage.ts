import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { CsvFileStorage } from "./types";

const SAFE_KEY = /^[a-z0-9][a-z0-9/_-]*\.csv$/u;

export class LocalCsvFileStorage implements CsvFileStorage {
    private readonly root: string;

    public constructor(root = path.join(process.cwd(), "storage", "app", "csv")) {
        this.root = path.resolve(root);
    }

    public async write(key: string, contents: Uint8Array | string): Promise<void> {
        const target = this.pathFor(key);
        await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const temporary = `${target}.${randomUUID()}.tmp`;

        try {
            const handle = await open(temporary, "wx", 0o600);
            try {
                await handle.writeFile(contents);
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
        const details = await lstat(target, { bigint: false });

        if (!details.isFile()) {
            throw new Error("CSV storage entry is not a regular file.");
        }

        return readFile(target);
    }

    private pathFor(key: string): string {
        if (!SAFE_KEY.test(key) || key.includes("//")) {
            throw new Error("Invalid CSV storage key.");
        }

        const target = path.resolve(this.root, key);
        if (!target.startsWith(`${this.root}${path.sep}`)) {
            throw new Error("CSV storage key escapes its configured root.");
        }

        return target;
    }
}
