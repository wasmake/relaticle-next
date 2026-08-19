import { handleConversations } from "@/server/chat/handler";
import { chatApiDependencies } from "@/server/chat/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const GET = (request: Request) => handleConversations(request, chatApiDependencies);
export const POST = GET;
