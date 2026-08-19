import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

const HelpLayout = ({ children }: Readonly<{ children: ReactNode }>) => {
    if (!getEnvironment().RELATICLE_FEATURE_DOCUMENTATION) notFound();
    return children;
};

export default HelpLayout;
