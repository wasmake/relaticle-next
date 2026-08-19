import {
    productionApiAccessResolver,
    productionActivityWriter,
    productionCustomFieldsService,
} from "@/server/api/production";

import { DrizzleTasksRepository } from "./drizzle-repository";
import type { TasksApiDependencies } from "./handler";
import { BullMqTaskAssigneeNotificationPort } from "./notifications";
import { TasksService } from "./service";
import { after } from "next/server";

export const tasksApiDependencies: TasksApiDependencies = {
    auth: productionApiAccessResolver,
    tasks: new TasksService(
        new DrizzleTasksRepository(productionActivityWriter),
        productionCustomFieldsService,
        new BullMqTaskAssigneeNotificationPort(undefined, (callback) => after(callback)),
    ),
};
