import { productionApiAccessResolver } from "@/server/api/production";
import { companiesApiDependencies } from "@/server/companies/production";
import { notesApiDependencies } from "@/server/notes/production";
import { opportunitiesApiDependencies } from "@/server/opportunities/production";
import { peopleApiDependencies } from "@/server/people/production";
import { tasksApiDependencies } from "@/server/tasks/production";
import { getQueue } from "@/server/queue/client";

import { ChatCancellationRegistry } from "./cancellation";
import { DrizzleChatRepository } from "./drizzle-repository";
import { ModelRegistry } from "./model-registry";
import { AnthropicProvider, OllamaProvider, OpenAiProvider } from "./providers";
import { ChatService } from "./service";
import { DrizzleChatToolbox } from "./tools";
import { RedisChatTurnLock } from "./turn-lock";
import { getRedisClient } from "@/server/redis/client";
import type { ModelDescriptor } from "./types";
import type { ChatApiDependencies } from "./handler";

const models: ModelDescriptor[] = [];
if (process.env.ANTHROPIC_API_KEY !== undefined) models.push({ id: "claude-sonnet", label: "Claude Sonnet", provider: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5", creditMultiplier: 1, supportsTools: true, selfHosted: false });
if (process.env.OPENAI_API_KEY !== undefined) models.push({ id: "gpt", label: "OpenAI GPT", provider: "openai", model: process.env.OPENAI_MODEL ?? "gpt-4.1", creditMultiplier: 1.5, supportsTools: true, selfHosted: false });
models.push({ id: "ollama", label: "Ollama", provider: "ollama", model: process.env.OLLAMA_MODEL ?? "llama3.1", creditMultiplier: 1, supportsTools: true, selfHosted: true });
for (const model of (process.env.OPENAI_COMPATIBLE_MODELS ?? "").split(",").map((value) => value.trim()).filter(Boolean)) models.push({ id: `compatible:${model}`, label: model, provider: "compatible", model, creditMultiplier: 1, supportsTools: true, selfHosted: true });

const repository = new DrizzleChatRepository();
const registry = new ModelRegistry(models, {
    anthropic: () => new AnthropicProvider({ baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1", apiKey: process.env.ANTHROPIC_API_KEY ?? "" }),
    openai: () => new OpenAiProvider({ baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", ...(process.env.OPENAI_API_KEY === undefined ? {} : { apiKey: process.env.OPENAI_API_KEY }) }),
    ollama: () => new OllamaProvider(process.env.OLLAMA_URL ?? "http://127.0.0.1:11434"),
    compatible: () => new OpenAiProvider({ baseUrl: process.env.OPENAI_COMPATIBLE_URL ?? "http://127.0.0.1:8080/v1", ...(process.env.OPENAI_COMPATIBLE_KEY === undefined ? {} : { apiKey: process.env.OPENAI_COMPATIBLE_KEY }) }),
});

const crm = {
    companies: companiesApiDependencies.companies,
    people: peopleApiDependencies.people,
    opportunities: opportunitiesApiDependencies.opportunities,
    tasks: tasksApiDependencies.tasks,
    notes: notesApiDependencies.notes,
};
export const chatService = new ChatService(repository, registry, new DrizzleChatToolbox(repository, crm), new ChatCancellationRegistry(), undefined, new RedisChatTurnLock(getRedisClient()));
export const chatModels = registry;
export const chatApiDependencies: ChatApiDependencies = {
    auth: productionApiAccessResolver,
    chat: chatService,
    models: registry,
    queue: { add: (name, data, options) => getQueue("chat").add(name, data, options) },
} as const;
