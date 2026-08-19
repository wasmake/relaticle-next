import { drizzle } from "drizzle-orm/postgres-js";

import { ActivityWriter } from "../web/src/server/activity/writer.js";
import { parseLaravelAppKeys } from "../web/src/server/auth/compatibility/laravel-encrypter.js";
import { ChatCancellationRegistry } from "../web/src/server/chat/cancellation.js";
import { DrizzleChatRepository } from "../web/src/server/chat/drizzle-repository.js";
import { ModelRegistry } from "../web/src/server/chat/model-registry.js";
import { AnthropicProvider, OllamaProvider, OpenAiProvider } from "../web/src/server/chat/providers.js";
import { ChatService, HeuristicTitleGenerator } from "../web/src/server/chat/service.js";
import { DrizzleChatToolbox } from "../web/src/server/chat/tools.js";
import type { ModelDescriptor } from "../web/src/server/chat/types.js";
import { CompaniesService } from "../web/src/server/companies/service.js";
import { DrizzleCompaniesRepository } from "../web/src/server/companies/drizzle-repository.js";
import { createRequestContext } from "../web/src/server/context/request-context.js";
import { DrizzleCsvEntityPort } from "../web/src/server/csv/drizzle-entity-port.js";
import { DrizzleCsvJobRepository } from "../web/src/server/csv/drizzle-repository.js";
import { CsvJobService } from "../web/src/server/csv/service.js";
import { LocalCsvFileStorage } from "../web/src/server/csv/storage.js";
import { DrizzleCustomFieldRepository } from "../web/src/server/custom-fields/drizzle-repository.js";
import { LaravelCustomFieldEncryption } from "../web/src/server/custom-fields/encryption.js";
import { CustomFieldsService } from "../web/src/server/custom-fields/service.js";
import { ulidSchema } from "../web/src/server/ids.js";
import { DrizzleMediaCustomFieldReferences } from "../web/src/server/media/custom-field-references.js";
import { DrizzleMediaRepository } from "../web/src/server/media/drizzle-repository.js";
import { fetchRemoteImage } from "../web/src/server/media/remote-image.js";
import { MediaService } from "../web/src/server/media/service.js";
import { LocalMediaFileStorage } from "../web/src/server/media/storage.js";
import { DrizzleNotesRepository } from "../web/src/server/notes/drizzle-repository.js";
import { NotesService } from "../web/src/server/notes/service.js";
import { DrizzleOpportunitiesRepository } from "../web/src/server/opportunities/drizzle-repository.js";
import { OpportunitiesService } from "../web/src/server/opportunities/service.js";
import { DrizzlePeopleRepository } from "../web/src/server/people/drizzle-repository.js";
import { PeopleService } from "../web/src/server/people/service.js";
import { DrizzleTasksRepository } from "../web/src/server/tasks/drizzle-repository.js";
import { BullMqTaskAssigneeNotificationPort, type TaskNotificationQueue } from "../web/src/server/tasks/notifications.js";
import { TasksService } from "../web/src/server/tasks/service.js";
import { ConcreteApplicationJobOperations } from "./application-operations.js";
import type { WorkerSqlClient } from "./database.js";
import type { WorkerEnvironment } from "./environment.js";

const createModels = (environment: WorkerEnvironment): readonly ModelDescriptor[] => {
    const models: ModelDescriptor[] = [];
    if (environment.ANTHROPIC_API_KEY !== undefined) models.push({ id: "claude-sonnet", label: "Claude Sonnet", provider: "anthropic", model: environment.ANTHROPIC_MODEL, creditMultiplier: 1, supportsTools: true, selfHosted: false });
    if (environment.OPENAI_API_KEY !== undefined) models.push({ id: "gpt", label: "OpenAI GPT", provider: "openai", model: environment.OPENAI_MODEL, creditMultiplier: 1.5, supportsTools: true, selfHosted: false });
    models.push({ id: "ollama", label: "Ollama", provider: "ollama", model: environment.OLLAMA_MODEL, creditMultiplier: 1, supportsTools: true, selfHosted: true });
    for (const model of environment.OPENAI_COMPATIBLE_MODELS.split(",").map((value) => value.trim()).filter(Boolean)) {
        models.push({ id: `compatible:${model}`, label: model, provider: "compatible", model, creditMultiplier: 1, supportsTools: true, selfHosted: true });
    }
    return models;
};

export const createProductionApplicationOperations = (
    sql: WorkerSqlClient,
    environment: WorkerEnvironment,
    taskQueue: TaskNotificationQueue,
): ConcreteApplicationJobOperations => {
    const database = drizzle(sql);
    const encryption = environment.APP_KEY === undefined
        ? undefined
        : new LaravelCustomFieldEncryption(parseLaravelAppKeys(environment.APP_KEY, environment.APP_PREVIOUS_KEYS));
    const activity = new ActivityWriter(environment.ACTIVITYLOG_ENABLED, encryption);
    const customFields = new CustomFieldsService(
        new DrizzleCustomFieldRepository(database),
        () => new Date(),
        encryption,
        new DrizzleMediaCustomFieldReferences(database),
    );
    const services = {
        companies: new CompaniesService(new DrizzleCompaniesRepository(activity, database), customFields),
        people: new PeopleService(new DrizzlePeopleRepository(activity, database), customFields),
        opportunities: new OpportunitiesService(new DrizzleOpportunitiesRepository(activity, database), customFields),
        tasks: new TasksService(
            new DrizzleTasksRepository(activity, database),
            customFields,
            new BullMqTaskAssigneeNotificationPort(taskQueue, (callback) => { void callback(); }),
        ),
        notes: new NotesService(new DrizzleNotesRepository(activity, database), customFields),
    };
    const csv = new CsvJobService(
        new DrizzleCsvJobRepository(database),
        new DrizzleCsvEntityPort(services, customFields, database),
        new LocalCsvFileStorage(),
    );

    const chatRepository = new DrizzleChatRepository(database);
    const models = new ModelRegistry(createModels(environment), {
        anthropic: () => new AnthropicProvider({ baseUrl: environment.ANTHROPIC_BASE_URL, apiKey: environment.ANTHROPIC_API_KEY ?? "" }),
        openai: () => new OpenAiProvider({ baseUrl: environment.OPENAI_BASE_URL, ...(environment.OPENAI_API_KEY === undefined ? {} : { apiKey: environment.OPENAI_API_KEY }) }),
        ollama: () => new OllamaProvider(environment.OLLAMA_URL),
        compatible: () => new OpenAiProvider({ baseUrl: environment.OPENAI_COMPATIBLE_URL, ...(environment.OPENAI_COMPATIBLE_KEY === undefined ? {} : { apiKey: environment.OPENAI_COMPATIBLE_KEY }) }),
    });
    const chat = new ChatService(chatRepository, models, new DrizzleChatToolbox(chatRepository, services, database), new ChatCancellationRegistry());
    const media = new MediaService(new DrizzleMediaRepository(database), new LocalMediaFileStorage());

    return new ConcreteApplicationJobOperations(
        {
            processExport: async (context, id) => csv.processExport(createRequestContext(context), ulidSchema.parse(id)),
            processImport: async (context, id) => csv.processImport(createRequestContext(context), ulidSchema.parse(id)),
        },
        {
            send: (identity, input) => chat.send({ teamId: ulidSchema.parse(identity.teamId), userId: ulidSchema.parse(identity.userId) }, input),
            cancel: (identity, conversationId) => chat.cancel({ teamId: ulidSchema.parse(identity.teamId), userId: ulidSchema.parse(identity.userId) }, conversationId),
        },
        new HeuristicTitleGenerator(),
        {
            replaceProvisional: async (conversationId, provisionalTitle, title) => {
                const rows = await sql<readonly { id: string }[]>`
                    update agent_conversations set title = ${title}, updated_at = now()
                    where id = ${conversationId} and title = ${provisionalTitle}
                    returning id
                `;
                return rows.length > 0;
            },
        },
        { fetch: (url, signal) => fetchRemoteImage(url, signal) },
        {
            replace: async (context, companyId, file) => {
                await media.upload(createRequestContext({
                    ...context,
                    userId: ulidSchema.parse(context.userId),
                    teamId: ulidSchema.parse(context.teamId),
                    credential: { kind: "personal_access_token", tokenId: ulidSchema.parse(companyId), abilities: ["read", "create", "update", "delete"] },
                }), { modelType: "company", modelId: ulidSchema.parse(companyId), collectionName: "logo", ...file, imagesOnly: true }, true);
            },
        },
    );
};
