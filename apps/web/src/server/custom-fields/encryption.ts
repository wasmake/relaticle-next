import {
    decryptLaravelStringWithKeys,
    encryptLaravelString,
    type LaravelAppKeyInput,
} from "@/server/auth/compatibility/laravel-encrypter";

import type { CustomFieldEncryption } from "./types";

export class LaravelCustomFieldEncryption implements CustomFieldEncryption {
    public constructor(private readonly appKeys: readonly LaravelAppKeyInput[]) {
        if (appKeys.length === 0) {
            throw new Error("At least one Laravel application key is required.");
        }
    }

    public encrypt(value: string): string {
        const currentKey = this.appKeys[0];

        if (currentKey === undefined) {
            throw new Error("A current Laravel application key is required.");
        }

        return encryptLaravelString(value, currentKey);
    }

    public decrypt(value: string): string {
        return decryptLaravelStringWithKeys(value, this.appKeys);
    }
}
