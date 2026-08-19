import { handleFeedback } from "@/server/chat/handler";
import { chatApiDependencies } from "@/server/chat/production";

export const runtime = "nodejs";
type Properties = Readonly<{ params: Promise<{ messageId: string }> }>;
const route = async (request: Request, { params }: Properties) => handleFeedback(request, (await params).messageId, chatApiDependencies);
export const POST = route;
export const DELETE = route;
