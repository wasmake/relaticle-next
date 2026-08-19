import { handleCancel } from "@/server/chat/handler";
import { chatApiDependencies } from "@/server/chat/production";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = async (request: Request, { params }: Readonly<{ params: Promise<{ conversationId: string }> }>) => handleCancel(request, (await params).conversationId, chatApiDependencies);
