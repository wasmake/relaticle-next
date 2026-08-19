import { randomUUID } from "node:crypto";

export interface RedisLockClient {
    set(
        key: string,
        value: string,
        millisecondsToken: "PX",
        timeoutMilliseconds: number,
        condition: "NX",
    ): Promise<"OK" | null>;
    eval(script: string, numberOfKeys: number, key: string, ...arguments_: (string | number)[]): Promise<unknown>;
}

export interface DistributedLease {
    renew(): Promise<boolean>;
    release(): Promise<void>;
}

export interface DistributedLock {
    acquire(key: string, timeoutMilliseconds: number): Promise<DistributedLease | undefined>;
}

const releaseScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
end
return 0
`;
const renewScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`;

export class RedisDistributedLock implements DistributedLock {
    public constructor(
        private readonly redis: RedisLockClient,
        private readonly prefix = "scheduler:lock",
    ) {}

    public async acquire(
        key: string,
        timeoutMilliseconds: number,
    ): Promise<DistributedLease | undefined> {
        const owner = randomUUID();
        const redisKey = `${this.prefix}:${key}`;
        const acquired = await this.redis.set(
            redisKey,
            owner,
            "PX",
            timeoutMilliseconds,
            "NX",
        );

        if (acquired !== "OK") {
            return undefined;
        }

        let released = false;

        return {
            renew: async () => {
                if (released) return false;
                return Number(await this.redis.eval(renewScript, 1, redisKey, owner, timeoutMilliseconds)) === 1;
            },
            release: async () => {
                if (released) return;
                released = true;
                await this.redis.eval(releaseScript, 1, redisKey, owner);
            },
        };
    }
}
