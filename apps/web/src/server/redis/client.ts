import Redis from "ioredis";

import { getEnvironment } from "@/server/env";

let redisClient: Redis | undefined;
let cacheRedisClient: Redis | undefined;

const redisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
} as const;

const createRedisClient = (database: number): Redis => {
    const environment = getEnvironment();

    return environment.REDIS_URL
        ? new Redis(environment.REDIS_URL, { ...redisOptions, db: database })
        : new Redis({
              ...redisOptions,
              host: environment.REDIS_HOST,
              port: environment.REDIS_PORT,
              username: environment.REDIS_USERNAME,
              password: environment.REDIS_PASSWORD,
              db: database,
          });
};

export const getRedisClient = (): Redis => {
    const environment = getEnvironment();

    if (redisClient !== undefined) {
        return redisClient;
    }

    redisClient = createRedisClient(environment.REDIS_DB);

    return redisClient;
};

export const getCacheRedisClient = (): Redis => {
    const environment = getEnvironment();

    cacheRedisClient ??= createRedisClient(environment.REDIS_CACHE_DB);

    return cacheRedisClient;
};

const closeClient = async (client: Redis | undefined): Promise<void> => {
    if (client === undefined) {
        return;
    }

    if (client.status === "wait" || client.status === "end") {
        client.disconnect();

        return;
    }

    await client.quit();
};

export const closeRedis = async (): Promise<void> => {
    const client = redisClient;
    const cacheClient = cacheRedisClient;
    redisClient = undefined;
    cacheRedisClient = undefined;

    await Promise.all([closeClient(client), closeClient(cacheClient)]);
};
