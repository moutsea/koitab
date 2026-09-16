import { dictionaries, isLocale, languages, locales } from "../../../lib/i18n";
import { origin } from "../../../lib/site";
export const dynamic = "force-static";
export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}
function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lang: string }> },
) {
  const { lang } = await params;
  if (!isLocale(lang)) return new Response("Not found", { status: 404 });
  const d = dictionaries[lang];
  const items = d.releases
    .map((r) => {
      const link = `${origin}/${lang}/changelog#v${r.version}`;
      return `<item><title>${esc(`KoiTab v${r.version} · ${r.title}`)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><description>${esc(r.notes.join(" / "))}</description></item>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>KoiTab · ${esc(d.nav.changelog)}</title><link>${origin}/${lang}/changelog</link><description>${esc(d.common.releaseIntro)}</description><language>${languages[lang].tag}</language><atom:link href="${origin}/${lang}/feed.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
