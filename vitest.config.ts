import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
            "@queue": fileURLToPath(
                new URL("./packages/queue/src", import.meta.url),
            ),
        },
    },
    test: {
        environment: "node",
        include: ["tests/next/**/*.test.ts"],
        restoreMocks: true,
    },
});
