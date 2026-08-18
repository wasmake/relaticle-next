interface JSON {
    rawJSON(text: string): object;
    isRawJSON(value: unknown): boolean;
}
