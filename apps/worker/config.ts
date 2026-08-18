import {
    queueContracts,
    resolveQueueContracts,
    type EnvironmentSource,
    type ResolvedQueueContract,
} from "../../packages/queue/src/index.js";

export const getWorkerProcessContracts = (
    source: EnvironmentSource = process.env,
): readonly ResolvedQueueContract[] =>
    resolveQueueContracts(source, queueContracts);
