import {
    productionApiAccessResolver,
    productionActivityWriter,
    productionCustomFieldsService,
} from "@/server/api/production";

import { DrizzleNotesRepository } from "./drizzle-repository";
import type { NotesApiDependencies } from "./handler";
import { NotesService } from "./service";

export const notesApiDependencies: NotesApiDependencies = {
    auth: productionApiAccessResolver,
    notes: new NotesService(
        new DrizzleNotesRepository(productionActivityWriter),
        productionCustomFieldsService,
    ),
};
