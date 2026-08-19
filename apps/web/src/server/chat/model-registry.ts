import type { ChatProvider, ModelDescriptor } from "./types";

export type ProviderFactory = (model: ModelDescriptor) => ChatProvider;

const defaultModels: readonly ModelDescriptor[] = [
    { id: "claude-sonnet", label: "Claude Sonnet", provider: "anthropic", model: "claude-sonnet-4-5", creditMultiplier: 1, supportsTools: true, selfHosted: false },
    { id: "gpt", label: "OpenAI GPT", provider: "openai", model: "gpt-4.1", creditMultiplier: 1.5, supportsTools: true, selfHosted: false },
    { id: "ollama", label: "Ollama", provider: "ollama", model: "llama3.1", creditMultiplier: 1, supportsTools: true, selfHosted: true },
];

export class ModelRegistry {
    private readonly models: readonly ModelDescriptor[];

    public constructor(
        models: readonly ModelDescriptor[] = defaultModels,
        private readonly factories: Readonly<Partial<Record<ModelDescriptor["provider"], ProviderFactory>>> = {},
    ) {
        const ids = new Set<string>();
        for (const model of models) {
            if (ids.has(model.id)) throw new Error(`Duplicate chat model: ${model.id}`);
            ids.add(model.id);
        }
        this.models = [...models];
    }

    public all(): readonly ModelDescriptor[] {
        return this.models;
    }

    public find(id: string): ModelDescriptor | undefined {
        return this.models.find((model) => model.id === id);
    }

    public resolve(id: string | undefined): Readonly<{ model: ModelDescriptor; provider: ChatProvider }> {
        const model = id === undefined || id === "auto" ? this.models[0] : this.find(id);
        if (model === undefined) throw new Error("No chat model is configured.");
        const factory = this.factories[model.provider];
        if (factory === undefined) throw new Error(`Chat provider ${model.provider} is not configured.`);
        return { model, provider: factory(model) };
    }

    public multiplierFor(model: string): number {
        return this.models.find((item) => item.model === model)?.creditMultiplier ?? 1;
    }
}
