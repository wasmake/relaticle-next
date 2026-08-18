export const queueNames = ["default", "imports", "chat"] as const;

export type QueueName = (typeof queueNames)[number];

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export interface QueueConcurrencyContract {
    readonly minimum: number;
    readonly maximum: number;
    readonly minimumEnvironmentVariable?: string;
    readonly maximumEnvironmentVariable?: string;
}

export interface QueueContract {
    readonly name: QueueName;
    readonly workerTimeoutMilliseconds: number;
    readonly defaultMaxAttempts: number;
    readonly waitThresholdMilliseconds: number;
    readonly concurrency: QueueConcurrencyContract;
}

export interface ResolvedQueueContract {
    readonly name: QueueName;
    readonly workerTimeoutMilliseconds: number;
    readonly defaultMaxAttempts: number;
    readonly waitThresholdMilliseconds: number;
    readonly concurrency: {
        readonly minimum: number;
        readonly maximum: number;
    };
}

const assertPositiveInteger = (value: number, label: string): void => {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${label} must be a positive safe integer.`);
    }
};

const validateConcurrency = (
    minimum: number,
    maximum: number,
    queueName: QueueName,
): void => {
    assertPositiveInteger(minimum, `${queueName} minimum concurrency`);
    assertPositiveInteger(maximum, `${queueName} maximum concurrency`);

    if (minimum > maximum) {
        throw new Error(
            `${queueName} minimum concurrency cannot exceed maximum concurrency.`,
        );
    }
};

export const validateQueueContracts = <
    const Contracts extends readonly QueueContract[],
>(
    contracts: Contracts,
): Contracts => {
    const names = new Set<QueueName>();

    for (const contract of contracts) {
        if (names.has(contract.name)) {
            throw new Error(`Duplicate queue name: ${contract.name}.`);
        }

        names.add(contract.name);
        assertPositiveInteger(
            contract.workerTimeoutMilliseconds,
            `${contract.name} timeout`,
        );
        assertPositiveInteger(
            contract.defaultMaxAttempts,
            `${contract.name} max attempts`,
        );
        assertPositiveInteger(
            contract.waitThresholdMilliseconds,
            `${contract.name} wait threshold`,
        );
        validateConcurrency(
            contract.concurrency.minimum,
            contract.concurrency.maximum,
            contract.name,
        );
    }

    return contracts;
};

const contracts = [
    {
        name: "default",
        workerTimeoutMilliseconds: 60_000,
        defaultMaxAttempts: 1,
        waitThresholdMilliseconds: 60_000,
        concurrency: {
            minimum: 3,
            maximum: 30,
        },
    },
    {
        name: "imports",
        workerTimeoutMilliseconds: 300_000,
        defaultMaxAttempts: 2,
        waitThresholdMilliseconds: 120_000,
        concurrency: {
            minimum: 3,
            maximum: 15,
        },
    },
    {
        name: "chat",
        workerTimeoutMilliseconds: 130_000,
        defaultMaxAttempts: 1,
        waitThresholdMilliseconds: 30_000,
        concurrency: {
            minimum: 1,
            maximum: 3,
            minimumEnvironmentVariable: "CHAT_WORKER_MIN",
            maximumEnvironmentVariable: "CHAT_WORKER_MAX",
        },
    },
] as const satisfies readonly QueueContract[];

export const queueContracts = validateQueueContracts(contracts);

const resolveEnvironmentInteger = (
    source: EnvironmentSource,
    variable: string | undefined,
    fallback: number,
): number => {
    if (variable === undefined) {
        return fallback;
    }

    const value = source[variable]?.trim();

    if (value === undefined || value === "") {
        return fallback;
    }

    if (!/^\d+$/.test(value)) {
        throw new Error(`${variable} must be a positive integer.`);
    }

    const resolved = Number(value);
    assertPositiveInteger(resolved, variable);

    return resolved;
};

export const resolveQueueContracts = (
    source: EnvironmentSource,
    contracts: readonly QueueContract[] = queueContracts,
): readonly ResolvedQueueContract[] => {
    validateQueueContracts(contracts);

    return contracts.map((contract): ResolvedQueueContract => {
        const minimum = resolveEnvironmentInteger(
            source,
            contract.concurrency.minimumEnvironmentVariable,
            contract.concurrency.minimum,
        );
        const maximum = resolveEnvironmentInteger(
            source,
            contract.concurrency.maximumEnvironmentVariable,
            contract.concurrency.maximum,
        );

        validateConcurrency(minimum, maximum, contract.name);

        return {
            name: contract.name,
            workerTimeoutMilliseconds: contract.workerTimeoutMilliseconds,
            defaultMaxAttempts: contract.defaultMaxAttempts,
            waitThresholdMilliseconds: contract.waitThresholdMilliseconds,
            concurrency: { minimum, maximum },
        };
    });
};
