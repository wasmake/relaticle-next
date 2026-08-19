import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ComparisonPage } from "@/app/_components/comparison-page";
import { alternativeCopy, alternativeSlugs, competitorFacts, type AlternativeSlug } from "@/server/marketing/content";

const isAlternative = (value: string): value is AlternativeSlug => alternativeSlugs.some((slug) => slug === value);
export const generateStaticParams = () => alternativeSlugs.map((competitor) => ({ competitor }));

export const generateMetadata = async ({ params }: Readonly<{ params: Promise<{ competitor: string }> }>): Promise<Metadata> => {
    const { competitor } = await params;
    if (!isAlternative(competitor)) return {};
    const title = `${competitorFacts[competitor].name} Alternative`;
    return { title, description: alternativeCopy[competitor].description, alternates: { canonical: `/alternatives/${competitor}` }, openGraph: { title, description: alternativeCopy[competitor].description, type: "website" } };
};

const Page = async ({ params }: Readonly<{ params: Promise<{ competitor: string }> }>) => {
    const { competitor } = await params;
    if (!isAlternative(competitor)) notFound();
    const title = `${competitorFacts[competitor].name} Alternative`;
    return <ComparisonPage title={title} badge="Alternative" description={alternativeCopy[competitor].description} opening={alternativeCopy[competitor].opening} competitor={competitorFacts[competitor]} migration />;
};
export default Page;
