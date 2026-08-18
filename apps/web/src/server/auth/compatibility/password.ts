import { compare } from "bcryptjs";

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/u;

export const isLaravelBcryptHash = (storedHash: string): boolean =>
    BCRYPT_HASH_PATTERN.test(storedHash);

export const verifyLaravelPassword = async (
    password: string,
    storedHash: string,
): Promise<boolean> => {
    if (!isLaravelBcryptHash(storedHash)) {
        return false;
    }

    const normalizedHash = storedHash.startsWith("$2y$")
        ? `$2b$${storedHash.slice(4)}`
        : storedHash;

    try {
        return await compare(password, normalizedHash);
    } catch {
        return false;
    }
};
