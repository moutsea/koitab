import { site } from "../content";
import releases from "../releases.json";

/**
 * RSS 2.0 更新日志。构建时静态生成(force-static),由 Cloudflare 边缘直接返回。
 *
 * 注意:这是**分发渠道**,不是 SEO 手段 —— 搜索引擎不靠 RSS 索引页面,
 * 真正的 SEO 工作在 layout.tsx 的元数据、JSON-LD、sitemap 与可抓取的静态 HTML 上。
 * 每条的链接指向 /changelog 的对应锚点,便于订阅者点进来。
 */
export const dynamic = "force-static";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function GET() {
  const items = releases
    .slice(0, 20)
    .map((r) => {
      const link = `${site.url}/changelog#v${r.version}`;
      const desc = r.notes.length ? r.notes.join(" / ") : r.summary;
      return [
        "    <item>",
        `      <title>${esc(`${site.name} v${r.version}`)}</title>`,
        `      <link>${esc(link)}</link>`,
        `      <guid isPermaLink="false">${esc(link)}</guid>`,
        `      <description>${esc(desc)}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(`${site.name} 更新日志`)}</title>
    <link>${esc(site.url)}</link>
    <description>${esc(site.description)}</description>
    <language>zh-CN</language>
    <atom:link href="${esc(`${site.url}/feed.xml`)}" rel="self" type="application/rss+xml" />
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
