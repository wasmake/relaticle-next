import { handleMentions } from "@/server/chat/handler";
import { chatApiDependencies } from "@/server/chat/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = (request: Request) => handleMentions(request, chatApiDependencies);
