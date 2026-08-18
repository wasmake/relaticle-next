import type { ReactNode } from "react";

type RootLayoutProperties = Readonly<{
    children: ReactNode;
}>;

const RootLayout = ({ children }: RootLayoutProperties) => (
    <html lang="en">
        <body>{children}</body>
    </html>
);

export default RootLayout;
