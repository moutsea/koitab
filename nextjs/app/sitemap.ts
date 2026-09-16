import type { MetadataRoute } from "next";
import { href, locales, sections } from "../lib/i18n";
import { alternatives, origin } from "../lib/site";
export default function sitemap(): MetadataRoute.Sitemap {
  return locales.flatMap((locale) =>
    sections.map((section) => ({
      url: `${origin}${href(locale, section)}`,
      alternates: { languages: alternatives(section) },
    })),
  );
}
