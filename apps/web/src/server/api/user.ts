import type { ApiAccessResolver } from "./http";
import { handleAuthenticatedApiRequest } from "./http";
import { jsonApiResponse } from "./errors";

export const handleUserRequest = (
    request: Request,
    accessResolver: ApiAccessResolver,
): Promise<Response> =>
    handleAuthenticatedApiRequest(
        request,
        accessResolver,
        async ({ user }, requestId) =>
            jsonApiResponse(
                {
                    data: {
                        id: user.id,
                        type: "users",
                        attributes: {
                            name: user.name,
                            email: user.email,
                        },
                    },
                },
                200,
                requestId,
            ),
    );
