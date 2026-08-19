import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ComparisonPage } from "@/app/_components/comparison-page";
import { comparisonCopy, comparisonSlugs, competitorFacts, type ComparisonSlug } from "@/server/marketing/content";

const prefix = "relaticle-vs-";
const competitorFrom = (value: string): ComparisonSlug | undefined => {
    if (!value.startsWith(prefix)) return undefined;
    const competitor = value.slice(prefix.length);
    return comparisonSlugs.find((slug) => slug === competitor);
};
export const generateStaticParams = () => comparisonSlugs.map((competitor) => ({ comparison: `${prefix}${competitor}` }));

export const generateMetadata = async ({ params }: Readonly<{ params: Promise<{ comparison: string }> }>): Promise<Metadata> => {
    const competitor = competitorFrom((await params).comparison);
    if (competitor === undefined) return {};
    const title = `Relaticle vs ${competitorFacts[competitor].name}`;
    return { title, description: comparisonCopy[competitor].description, alternates: { canonical: `/compare/${prefix}${competitor}` }, openGraph: { title, description: comparisonCopy[competitor].description, type: "website" } };
};

const Page = async ({ params }: Readonly<{ params: Promise<{ comparison: string }> }>) => {
    const competitor = competitorFrom((await params).comparison);
    if (competitor === undefined) notFound();
    const title = `Relaticle vs ${competitorFacts[competitor].name}`;
    return <ComparisonPage title={title} badge="Comparison" description={comparisonCopy[competitor].description} opening={comparisonCopy[competitor].opening} competitor={competitorFacts[competitor]} />;
};
export default Page;
