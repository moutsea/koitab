import { notFound } from "next/navigation";
import { isLocale, isSection, sections } from "../../../lib/i18n";
import { pageMetadata } from "../../../lib/site";
import { SitePage } from "../../../components/site-page";

type Params = Promise<{ lang: string; slug?: string[] }>;
export function generateStaticParams() {
  return sections.map((section) => ({ slug: section ? [section] : [] }));
}
function route({ lang, slug = [] }: Awaited<Params>) {
  const section = slug.join("/");
  if (!isLocale(lang) || !isSection(section)) notFound();
  return { lang, section };
}
export async function generateMetadata({ params }: { params: Params }) {
  const { lang, section } = route(await params);
  return pageMetadata(lang, section);
}
export default async function Page({ params }: { params: Params }) {
  const { lang, section } = route(await params);
  return <SitePage locale={lang} section={section} />;
}
