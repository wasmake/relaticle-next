import { productionApiAccessResolver } from "@/server/api/production";

import { DrizzleMediaRepository } from "./drizzle-repository";
import { MediaService } from "./service";
import { LocalMediaFileStorage } from "./storage";

export const productionMediaService = new MediaService(new DrizzleMediaRepository(), new LocalMediaFileStorage());
export const mediaApiDependencies = { auth: productionApiAccessResolver, media: productionMediaService } as const;
