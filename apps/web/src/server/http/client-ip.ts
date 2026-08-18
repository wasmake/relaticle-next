import { isIP } from "node:net";

const isPrivateIpv4 = (address: string): boolean => {
    const octets = address.split(".").map(Number);
    const first = octets[0];
    const second = octets[1];

    if (octets.length !== 4 || first === undefined || second === undefined) {
        return false;
    }

    return (
        first === 10 ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
    );
};

const isPrivateIp = (address: string): boolean => {
    if (isIP(address) === 4) {
        return isPrivateIpv4(address);
    }

    const normalized = address.toLowerCase();

    return (
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        /^fe[89ab]/u.test(normalized)
    );
};

const validAddresses = (value: string | null): readonly string[] =>
    value === null
        ? []
        : value
              .split(",")
              .map((address) => address.trim())
              .filter((address) => isIP(address) !== 0);

export const resolveClientIp = (headers: Pick<Headers, "get">): string => {
    const forwardedAddresses = validAddresses(headers.get("x-forwarded-for"));

    for (let index = forwardedAddresses.length - 1; index >= 0; index -= 1) {
        const address = forwardedAddresses[index];

        if (address !== undefined && !isPrivateIp(address)) {
            return address;
        }
    }

    const realIp = headers.get("x-real-ip")?.trim();

    return realIp !== undefined && isIP(realIp) !== 0 ? realIp : "unknown";
};
