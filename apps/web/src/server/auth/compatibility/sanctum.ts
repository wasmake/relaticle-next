import { createHash, timingSafeEqual } from "node:crypto";

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;

export class InvalidSanctumTokenFormatError extends Error {
    public constructor() {
        super("Invalid Sanctum personal access token format.");
        this.name = "InvalidSanctumTokenFormatError";
    }
}

export type ParsedSanctumToken =
    | Readonly<{
          kind: "id";
          tokenId: string;
          secret: string;
      }>
    | Readonly<{
          kind: "legacy";
          secret: string;
      }>;

export const parseSanctumPlainTextToken = (
    plainTextToken: string,
): ParsedSanctumToken => {
    if (plainTextToken.length === 0) {
        throw new InvalidSanctumTokenFormatError();
    }

    const separatorIndex = plainTextToken.indexOf("|");

    if (separatorIndex === -1) {
        return { kind: "legacy", secret: plainTextToken };
    }

    const tokenId = plainTextToken.slice(0, separatorIndex);
    const secret = plainTextToken.slice(separatorIndex + 1);

    if (!/^[1-9][0-9]*$/u.test(tokenId) || secret.length === 0) {
        throw new InvalidSanctumTokenFormatError();
    }

    if (BigInt(tokenId) > POSTGRES_BIGINT_MAX) {
        throw new InvalidSanctumTokenFormatError();
    }

    return { kind: "id", tokenId, secret };
};

export const hashSanctumTokenSecret = (secret: string): string =>
    createHash("sha256").update(secret, "utf8").digest("hex");

export const verifySanctumTokenSecret = (
    secret: string,
    storedHash: string,
): boolean => {
    const candidateDigest = createHash("sha256").update(secret, "utf8").digest();
    const storedHashIsValid = SHA256_HEX_PATTERN.test(storedHash);
    const storedDigest = storedHashIsValid
        ? Buffer.from(storedHash, "hex")
        : Buffer.alloc(candidateDigest.length);
    const hashesMatch = timingSafeEqual(candidateDigest, storedDigest);

    return storedHashIsValid && hashesMatch;
};
