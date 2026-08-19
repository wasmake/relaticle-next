import { handleContactPost } from "@/server/marketing/contact";

export const POST = (request: Request) => handleContactPost(request);
