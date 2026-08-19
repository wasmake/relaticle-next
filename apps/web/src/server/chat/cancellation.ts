export interface CancellationPort {
    begin(conversationId: string): AbortController;
    cancel(conversationId: string): boolean;
    end(conversationId: string, controller: AbortController): void;
}

export class ChatCancellationRegistry implements CancellationPort {
    private readonly active = new Map<string, AbortController>();

    public begin(conversationId: string): AbortController {
        if (this.active.has(conversationId)) throw new Error("A response is already being generated for this conversation.");
        const controller = new AbortController();
        this.active.set(conversationId, controller);
        return controller;
    }

    public cancel(conversationId: string): boolean {
        const controller = this.active.get(conversationId);
        if (controller === undefined) return false;
        controller.abort();
        return true;
    }

    public end(conversationId: string, controller: AbortController): void {
        if (this.active.get(conversationId) === controller) this.active.delete(conversationId);
    }
}
