import { handleAction } from "@/server/chat/handler";
import { chatApiDependencies } from "@/server/chat/production";

export const runtime = "nodejs";
export const POST = async (request: Request, { params }: Readonly<{ params: Promise<{ actionId: string }> }>) => handleAction(request, (await params).actionId, "reject", chatApiDependencies);
