import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
    metadataBase: new URL(process.env.APP_URL ?? "https://relaticle.com"),
    title: { default: "Relaticle", template: "%s - Relaticle" },
    description: "Open-source relationship workspace for modern teams.",
    alternates: { canonical: "/" },
    openGraph: { siteName: "Relaticle", type: "website", images: ["/images/open-graph.jpg"] },
    twitter: { card: "summary_large_image", images: ["/images/open-graph.jpg"] },
};

type RootLayoutProperties = Readonly<{
    children: ReactNode;
}>;

const RootLayout = ({ children }: RootLayoutProperties) => (
    <html lang="en">
        <body>{children}</body>
    </html>
);

export default RootLayout;
