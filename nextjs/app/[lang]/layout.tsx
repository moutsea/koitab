import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale, languages, locales } from "../../lib/i18n";
import "../globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://koitab.com"),
  applicationName: "KoiTab",
  icons: { icon: "/assets/favicon.png", apple: "/assets/logo.png" },
};
export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <html lang={languages[lang].tag}>
      <body>{children}</body>
    </html>
  );
}
