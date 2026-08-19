import {
    createHttpAuthConfiguration,
    DrizzleHttpAuthRepository,
} from "@/server/auth/http";
import { ActivityWriter } from "@/server/activity/writer";
import { DrizzleHostedWorkspaceRepository } from "@/server/billing/drizzle-repository";
import { HostedWorkspaceAccess } from "@/server/billing/hosted-workspace-access";
import { DrizzleCustomFieldRepository } from "@/server/custom-fields/drizzle-repository";
import { LaravelCustomFieldEncryption } from "@/server/custom-fields/encryption";
import { CustomFieldsService } from "@/server/custom-fields/service";
import { DrizzleMediaCustomFieldReferences } from "@/server/media/custom-field-references";
import { queueMailcoachEvent } from "@/server/accounts/mailcoach";
import { getEnvironment } from "@/server/env";

import { ProductionApiAccessResolver } from "./access";
import {
    ApiRateLimiter,
    RedisFixedWindowRateLimitStore,
} from "./rate-limiter";

const environment = getEnvironment();
const authConfiguration = createHttpAuthConfiguration();
const customFieldEncryption =
    authConfiguration.appKeys.length === 0
        ? undefined
        : new LaravelCustomFieldEncryption(authConfiguration.appKeys);

export const productionApiAccessResolver = new ProductionApiAccessResolver(
    new DrizzleHttpAuthRepository(),
    authConfiguration,
    new ApiRateLimiter(new RedisFixedWindowRateLimitStore(environment)),
    new HostedWorkspaceAccess(
        new DrizzleHostedWorkspaceRepository(),
        environment.RELATICLE_FEATURE_BILLING,
    ),
    environment,
);

export const productionActivityWriter = new ActivityWriter(
    environment.ACTIVITYLOG_ENABLED,
    customFieldEncryption,
    undefined,
    (userId) => queueMailcoachEvent(userId, "first-data"),
);

export const productionCustomFieldsService = new CustomFieldsService(
    new DrizzleCustomFieldRepository(),
    () => new Date(),
    customFieldEncryption,
    new DrizzleMediaCustomFieldReferences(),
);
