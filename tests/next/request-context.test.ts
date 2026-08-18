import { describe, expect, it } from "vitest";

import {
    createRequestContext,
    hasApiAbility,
} from "@/server/context/request-context";

const userId = "01J00000000000000000000000";
const teamId = "01J00000000000000000000001";

describe("request tenant context", () => {
    it("normalizes ULIDs and enforces personal token abilities", () => {
        const context = createRequestContext({
            requestId: "request-1",
            userId: userId.toLowerCase(),
            teamId: teamId.toLowerCase(),
            credential: {
                kind: "personal_access_token",
                tokenId: "10",
                abilities: ["read", "update"],
            },
        });

        expect(context.userId).toBe(userId);
        expect(context.teamId).toBe(teamId);
        expect(hasApiAbility(context, "read")).toBe(true);
        expect(hasApiAbility(context, "delete")).toBe(false);
    });

    it("rejects malformed tenant identifiers", () => {
        expect(() =>
            createRequestContext({
                requestId: "request-1",
                userId,
                teamId: "another-team",
                credential: { kind: "session", sessionId: "session-1" },
            }),
        ).toThrow();
    });
});
