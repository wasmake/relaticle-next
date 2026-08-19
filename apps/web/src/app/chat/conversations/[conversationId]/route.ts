import { handleConversation } from "@/server/chat/handler";
import { chatApiDependencies } from "@/server/chat/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Properties = Readonly<{ params: Promise<{ conversationId: string }> }>;
const route = async (request: Request, { params }: Properties) => handleConversation(request, (await params).conversationId, chatApiDependencies);
export const GET = route;
export const PATCH = route;
export const DELETE = route;
