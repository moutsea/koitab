import type { Metadata } from "next";
import {
  dictionaries,
  href,
  languages,
  locales,
  type Locale,
  type Section,
} from "./i18n";
import releases from "../app/releases.json";

export const origin = "https://koitab.com";
export const downloadPath = "/downloads/koitab-latest.zip";
export const version = releases[0].version;
export function alternatives(section: Section) {
  return Object.fromEntries([
    ...locales.map((locale) => [
      languages[locale].tag,
      `${origin}${href(locale, section)}`,
    ]),
    ["x-default", `${origin}${href("zh", section)}`],
  ]);
}
export function pageMetadata(locale: Locale, section: Section): Metadata {
  const d = dictionaries[locale];
  const { title, description } = d.meta[section || "home"];
  const url = `${origin}${href(locale, section)}`;
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: alternatives(section),
      types: {
        "application/rss+xml": [
          {
            url: `${origin}/${locale}/feed.xml`,
            title: `KoiTab · ${d.nav.changelog}`,
          },
        ],
      },
    },
    openGraph: {
      type: "website",
      title,
      description,
      url,
      siteName: "KoiTab",
      locale: languages[locale].og,
      alternateLocale: locales
        .filter((l) => l !== locale)
        .map((l) => languages[l].og),
      images: [
        {
          url: `${origin}/assets/logo.png`,
          width: 512,
          height: 512,
          alt: "KoiTab",
        },
      ],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [`${origin}/assets/logo.png`],
    },
  };
}
export function structuredData(locale: Locale, section: Section) {
  const d = dictionaries[locale];
  const url = `${origin}${href(locale, section)}`;
  const data: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${url}#page`,
      url,
      name: d.meta[section || "home"].title,
      description: d.meta[section || "home"].description,
      inLanguage: languages[locale].tag,
      isPartOf: { "@id": `${origin}/#website` },
    },
  ];
  if (!section)
    data.push({
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${origin}/#website`,
      name: "KoiTab",
      url: origin,
      inLanguage: locales.map((l) => languages[l].tag),
    });
  if (!section || section === "download")
    data.push({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "KoiTab",
      applicationCategory: "BrowserApplication",
      operatingSystem: "Chrome 121+, Microsoft Edge 121+",
      url,
      downloadUrl: `${origin}${downloadPath}`,
      softwareVersion: version,
      description: d.meta.home.description,
      inLanguage: locales.map((l) => languages[l].tag),
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    });
  if (section)
    data.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: d.nav.home,
          item: `${origin}${href(locale)}`,
        },
        { "@type": "ListItem", position: 2, name: d.nav[section], item: url },
      ],
    });
  if (section === "faq")
    data.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: d.faq.items.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    });
  return data;
}
