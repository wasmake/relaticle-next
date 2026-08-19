import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const outputRoot = fileURLToPath(new URL("../../", import.meta.url));

const emittedModule = (candidate: string): string | undefined => {
    const file = candidate.endsWith(".js") ? candidate : `${candidate}.js`;
    if (existsSync(file)) return pathToFileURL(file).href;
    const index = path.join(candidate, "index.js");
    return existsSync(index) ? pathToFileURL(index).href : undefined;
};

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("@/")) {
            const resolved = emittedModule(path.join(outputRoot, "apps/web/src", specifier.slice(2)));
            if (resolved !== undefined) return { url: resolved, shortCircuit: true };
        }
        if (specifier.startsWith("@queue/")) {
            const resolved = emittedModule(path.join(outputRoot, "packages/queue/src", specifier.slice(7)));
            if (resolved !== undefined) return { url: resolved, shortCircuit: true };
        }
        if ((specifier.startsWith("./") || specifier.startsWith("../")) && path.extname(specifier) === "") {
            const parent = context.parentURL === undefined ? undefined : fileURLToPath(context.parentURL);
            if (parent !== undefined) {
                const resolved = emittedModule(path.resolve(path.dirname(parent), specifier));
                if (resolved !== undefined) return { url: resolved, shortCircuit: true };
            }
        }
        return nextResolve(specifier, context);
    },
});

import("./main.js").catch((error: unknown) => {
    console.error("BullMQ worker terminated", {
        error: error instanceof Error ? error.message : "Unknown error",
    });
    process.exitCode = 1;
});
