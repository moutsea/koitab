import type { Metadata } from "next";
import "./globals.css";
import { site } from "./content";
import releases from "./releases.json";

const latestVersion = releases[0]?.version ?? "0.0.0";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: `%s · ${site.name}` },
  description: site.description,
  keywords: site.keywords,
  applicationName: site.name,
  authors: [{ name: site.name, url: site.url }],
  creator: site.name,
  publisher: site.name,
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": [{ url: "/feed.xml", title: `${site.name} 更新日志` }],
    },
  },
  openGraph: {
    type: "website",
    url: site.url,
    siteName: site.name,
    title: site.title,
    description: site.description,
    locale: "zh_CN",
    images: [{ url: site.ogImage, width: 512, height: 512, alt: `${site.name} logo` }],
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
    images: [site.ogImage],
  },
  icons: {
    icon: [{ url: "/assets/favicon.png", type: "image/png" }],
    apple: [{ url: "/assets/logo.png" }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "technology",
};

/** 结构化数据:WebSite + SoftwareApplication(免费软件 + 下载地址) */
const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.name,
    url: site.url,
    description: site.description,
    inLanguage: "zh-CN",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: site.name,
    applicationCategory: "BrowserApplication",
    operatingSystem: "Chrome 121+, Microsoft Edge 121+ (Chromium)",
    description: site.description,
    url: site.url,
    downloadUrl: `${site.url}${site.downloadPath}`,
    softwareVersion: latestVersion,
    inLanguage: "zh-CN",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "CNY" },
  },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
