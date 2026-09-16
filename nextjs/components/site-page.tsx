import Link from "next/link";
import { LanguagePicker } from "./language-picker";
import {
  dictionaries,
  href,
  languages,
  locales,
  type Dictionary,
  type Locale,
  type Section,
} from "../lib/i18n";
import { downloadPath, structuredData, version } from "../lib/site";
import history from "../app/releases.json";
import screenshotSizes from "../lib/screenshots.json";

function Arrow({ down = false }: { down?: boolean }) {
  return (
    <span aria-hidden="true" className="arrow">
      {down ? "↓" : "↗"}
    </span>
  );
}
function Logo() {
  // The existing hand-painted mark is a local, fixed-size asset.
  return (
    <span className="brand">
      <img src="/assets/logo.png" width="40" height="40" alt="" />
      <span>
        KoiTab
        <span className="brand-note" lang="zh-CN">
          锦鲤 · 标签有序
        </span>
      </span>
    </span>
  );
}
function Header({
  locale,
  section,
  d,
}: {
  locale: Locale;
  section: Section;
  d: Dictionary;
}) {
  const nav = ["features", "guide", "faq"] as const;
  return (
    <>
      <a className="skip" href="#main">
        {d.common.skip}
      </a>
      <header className="site-header">
        <div className="header-inner wrap">
          <Link href={href(locale)} aria-label={`KoiTab · ${d.nav.home}`}>
            <Logo />
          </Link>
          <nav className="desktop-nav" aria-label={d.common.directory}>
            {nav.map((key) => (
              <Link
                key={key}
                href={href(locale, key)}
                aria-current={section === key ? "page" : undefined}
              >
                {d.nav[key]}
              </Link>
            ))}
            <a
              href="https://github.com/moutsea/koitab"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub <Arrow />
            </a>
          </nav>
          <div className="header-actions">
            <LanguagePicker key={`${locale}/${section}`}>
              <summary aria-label={d.common.language}>
                <span aria-hidden="true">文 / A</span>
                <span className="selected-language">
                  {languages[locale].name}
                </span>
                <span className="chevron" aria-hidden="true">
                  ⌄
                </span>
              </summary>
              <nav className="language-menu" aria-label={d.common.language}>
                {locales.map((l) => (
                  <a
                    key={l}
                    href={href(l, section)}
                    hrefLang={languages[l].tag}
                    lang={languages[l].tag}
                    aria-current={locale === l ? "true" : undefined}
                  >
                    {languages[l].name}
                    <span aria-hidden="true">{l === locale ? "✓" : ""}</span>
                  </a>
                ))}
              </nav>
            </LanguagePicker>
            <Link
              className="button small header-download"
              href={href(locale, "download")}
            >
              {d.nav.download}
              <Arrow down />
            </Link>
            <details key={section} className="mobile-menu">
              <summary>
                {d.common.menu}
                <span aria-hidden="true">＋</span>
              </summary>
              <nav aria-label={d.common.menu}>
                {(
                  [
                    "",
                    "features",
                    "guide",
                    "download",
                    "privacy",
                    "faq",
                    "changelog",
                  ] as const
                ).map((s) => (
                  <Link
                    key={s}
                    href={href(locale, s)}
                    aria-current={s === section ? "page" : undefined}
                  >
                    {d.nav[s || "home"]}
                  </Link>
                ))}
                <a
                  href="https://github.com/moutsea/koitab"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub <Arrow />
                </a>
              </nav>
            </details>
          </div>
        </div>
      </header>
    </>
  );
}
function Footer({ locale, d }: { locale: Locale; d: Dictionary }) {
  return (
    <footer className="site-footer wrap">
      <div className="footer-top">
        <div className="footer-brand">
          <Link href={href(locale)}>
            <Logo />
          </Link>
          <p>{d.common.footer}</p>
        </div>
        <nav className="footer-directory" aria-label={d.common.directory}>
          {(
            [
              "features",
              "guide",
              "download",
              "privacy",
              "faq",
              "changelog",
            ] as const
          ).map((s) => (
            <Link href={href(locale, s)} key={s}>
              {d.nav[s]}
            </Link>
          ))}
        </nav>
        <section
          className="footer-projects"
          aria-labelledby="footer-projects-heading"
        >
          <h2 id="footer-projects-heading">{d.common.alsoBuilt}</h2>
          <ul>
            {[
              {
                name: "koinote",
                url: "https://koinote.app",
                description: d.common.koinoteDescription,
              },
              {
                name: "KoiAgent",
                url: "https://koiagent.app",
                description: d.common.koiagentDescription,
              },
              {
                name: "kimiseek",
                url: "https://kimiseek.app",
                description: d.common.kimiseekDescription,
              },
              {
                name: "ai in ide",
                url: "https://aiinide.com",
                description: d.common.aiinideDescription,
              },
            ].map((project) => (
              <li key={project.url}>
                <a href={project.url} target="_blank" rel="noopener noreferrer">
                  <span>
                    {project.name}
                    <Arrow />
                  </span>
                  <small>{project.description}</small>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()} KoiTab{" "}
          <span className="footer-divider">/</span> {d.common.free}
        </span>
      </div>
    </footer>
  );
}
function Popup({ caption }: { caption: string }) {
  return (
    <figure className="preview-figure">
      <div className="preview-art" aria-hidden="true">
        <div className="sun-disc" />
        <div className="vertical-note" lang="zh-CN">
          一页一境<span>万事归序</span>
        </div>
        <div className="browser-strip">
          <span />
          <span />
          <span />
          <i>koitab</i>
        </div>
        <div className="popup-paper" lang="zh-CN">
          <div className="popup-head">
            <Logo />
            <span className="popup-version">v{version}</span>
          </div>
          <div className="popup-tabs">
            <span>诊断</span>
            <span className="active">标签页</span>
            <span>收藏夹</span>
          </div>
          <div className="popup-search">
            <span>⌕</span> 搜索标签页…
          </div>
          <div className="popup-group">
            <div className="popup-group-title">
              <span className="group-dot" /> notion.so <span>3 页</span>
            </div>
            <p>
              <i>文</i> 一周的灵感与计划
            </p>
            <p>
              <i>记</i> 留待慢慢读的文章
            </p>
            <p>
              <i>集</i> 我的数字书房
            </p>
          </div>
          <div className="popup-group compact">
            <div className="popup-group-title">
              <span className="group-dot moss" /> github.com{" "}
              <span>
                5 页 <b>⌄</b>
              </span>
            </div>
          </div>
          <div className="popup-group compact">
            <div className="popup-group-title">
              <span className="group-dot ochre" /> wikipedia.org{" "}
              <span>
                2 页 <b>⌄</b>
              </span>
            </div>
          </div>
          <div className="popup-foot">
            <span>10 个标签页 · 3 个站点</span>
            <strong>一键整理</strong>
          </div>
        </div>
        <div className="art-baseline" />
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
function Home({ locale, d }: { locale: Locale; d: Dictionary }) {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-copy">
          <p className="eyebrow">
            <span />
            {d.home.eyebrow}
          </p>
          <h1>
            {d.home.title}
            <em>{d.home.accent}</em>
          </h1>
          <p className="hero-intro">{d.home.intro}</p>
          <div className="actions">
            <Link className="button" href={href(locale, "download")}>
              {d.common.download}
              <Arrow down />
            </Link>
            <Link className="text-link" href={href(locale, "guide")}>
              {d.common.guide}
              <Arrow />
            </Link>
          </div>
          <p className="quiet-note">{d.home.note}</p>
        </div>
        <Popup caption={d.common.demo} />
      </section>
      <div className="edition-strip wrap">
        <span lang="zh-CN" className="edition-label">
          锦鲤手帖
        </span>
        <span>{d.common.browser}</span>
        <span>v{version}</span>
        <span className="edition-free">{d.common.free}</span>
      </div>
      <section className="principles wrap" id="features">
        <div className="section-heading">
          <span className="section-number">01 /</span>
          <div>
            <h2>{d.home.chapter}</h2>
            <p>{d.home.chapterIntro}</p>
          </div>
        </div>
        <div className="principle-grid">
          {d.home.principles.map((p, i) => (
            <article key={p.mark}>
              <span className="principle-mark" lang="zh-CN" aria-hidden="true">
                {p.mark}
              </span>
              <span className="small-index">0{i + 1}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </article>
          ))}
        </div>
        <Link className="text-link" href={href(locale, "features")}>
          {d.common.more}
          <Arrow />
        </Link>
      </section>
      <section className="handbook wrap">
        <div className="section-heading">
          <span className="section-number">02 /</span>
          <div>
            <h2>{d.home.index}</h2>
            <p>{d.home.indexIntro}</p>
          </div>
        </div>
        <div className="handbook-links">
          {(["guide", "privacy", "faq"] as const).map((s, i) => (
            <Link href={href(locale, s)} key={s}>
              <span className="small-index">0{i + 1}</span>
              <span>
                <h3>{d.nav[s]}</h3>
                <p>{d.meta[s].description}</p>
              </span>
              <Arrow />
            </Link>
          ))}
        </div>
      </section>
      <section className="closing wrap">
        <h2>{d.home.closing}</h2>
        <p>{d.home.closingBody}</p>
        <Link className="button" href={href(locale, "download")}>
          {d.common.download}
          <Arrow down />
        </Link>
      </section>
    </>
  );
}
function PageHeading({
  locale,
  section,
  d,
}: {
  locale: Locale;
  section: Exclude<Section, "">;
  d: Dictionary;
}) {
  const copy =
    section === "changelog"
      ? {
          eyebrow: d.nav.changelog,
          title: d.nav.changelog,
          intro: d.common.releaseIntro,
        }
      : d[section];
  return (
    <header className="page-heading wrap">
      <nav className="breadcrumb" aria-label={d.common.directory}>
        <Link href={href(locale)}>{d.nav.home}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{d.nav[section]}</span>
      </nav>
      <p className="eyebrow">
        <span />
        {copy.eyebrow}
      </p>
      <h1>{copy.title}</h1>
      <p className="page-intro">{copy.intro}</p>
      <span className="page-watermark" lang="zh-CN" aria-hidden="true">
        {
          {
            features: "理",
            guide: "阅",
            download: "得",
            privacy: "守",
            faq: "问",
            changelog: "新",
          }[section]
        }
      </span>
    </header>
  );
}
function Related({
  locale,
  d,
  sections: items,
}: {
  locale: Locale;
  d: Dictionary;
  sections: Exclude<Section, "">[];
}) {
  return (
    <aside className="related wrap">
      <p className="eyebrow">{d.common.next}</p>
      <div>
        {items.map((s) => (
          <Link href={href(locale, s)} key={s}>
            <span>{d.nav[s]}</span>
            <Arrow />
          </Link>
        ))}
      </div>
    </aside>
  );
}
function Features({ d }: { d: Dictionary }) {
  return (
    <div className="feature-list wrap">
      {d.features.items.map((item, i) => (
        <article className="feature-row" key={item.title}>
          <span className="feature-number">0{i + 1}</span>
          <h2>{item.title}</h2>
          <div>
            <p>{item.body}</p>
            <p className="feature-detail">{item.detail}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
function GuideScreenshot({
  locale,
  d,
  name,
}: {
  locale: Locale;
  d: Dictionary;
  name: "diagnosis" | "tabs" | "collections";
}) {
  const src = `/screenshots/${name}-${locale}.webp`;
  const size = screenshotSizes[locale][name];
  return (
    <figure className="guide-screenshot">
      <a href={src} target="_blank" rel="noopener noreferrer">
        <img
          src={src}
          width={size.width}
          height={size.height}
          alt={d.guide.screenshots[name]}
          loading="lazy"
          decoding="async"
        />
      </a>
      <figcaption>
        {d.guide.screenshots[name]}
        <small>{d.guide.screenshots.note}</small>
      </figcaption>
    </figure>
  );
}
function Guide({ locale, d }: { locale: Locale; d: Dictionary }) {
  return (
    <div className="reading-layout wrap">
      <aside className="margin-note">
        <h2>{d.common.menu}</h2>
        <nav>
          {d.guide.items.map((s, i) => (
            <a href={`#step-${i + 1}`} key={s.title}>
              0{i + 1} / {s.title}
            </a>
          ))}
        </nav>
        <Link className="text-link" href={href(locale, "download")}>
          {d.nav.download}
          <Arrow />
        </Link>
      </aside>
      <div className="reading-body">
        <div className="workflow">
          {d.guide.workflow.map((s, i) => (
            <span key={s}>
              <b>0{i + 1}</b>
              {s}
            </span>
          ))}
        </div>
        {d.guide.items.map((s, i) => (
          <section
            className="reading-section"
            id={`step-${i + 1}`}
            key={s.title}
          >
            <span className="small-index">0{i + 1}</span>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
            {i === 0 && (
              <GuideScreenshot locale={locale} d={d} name="diagnosis" />
            )}
            {i === 2 && <GuideScreenshot locale={locale} d={d} name="tabs" />}
            {i === 4 && (
              <GuideScreenshot locale={locale} d={d} name="collections" />
            )}
          </section>
        ))}
        <aside className="ink-note">
          <h2>{d.guide.tipTitle}</h2>
          <p>{d.guide.tip}</p>
        </aside>
      </div>
    </div>
  );
}
function Download({ d }: { d: Dictionary }) {
  return (
    <div className="download-layout wrap">
      <aside className="download-card">
        <img src="/assets/logo.png" width="100" height="100" alt="KoiTab" />
        <p className="eyebrow">
          KoiTab <span className="version">v{version}</span>
        </p>
        <h2>{d.download.package}</h2>
        <p>{d.download.format}</p>
        <a className="button" href={downloadPath} download>
          {d.common.download}
          <Arrow down />
        </a>
        <p className="quiet-note">{d.download.storeNote}</p>
        <div className="download-requirements">
          <p>{d.download.requirements}</p>
          <p>{d.download.languageNote}</p>
        </div>
      </aside>
      <div className="reading-body">
        <h2 className="installation-heading">{d.download.install}</h2>
        {d.download.steps.map((s, i) => (
          <section className="reading-section" key={s.title}>
            <span className="small-index">0{i + 1}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            {i === 1 && (
              <div className="browser-addresses">
                <code>chrome://extensions</code>
                <code>edge://extensions</code>
              </div>
            )}
          </section>
        ))}
        <aside className="ink-note">
          <h2>{d.download.updateTitle}</h2>
          <p>{d.download.update}</p>
        </aside>
      </div>
    </div>
  );
}
function Privacy({ d }: { d: Dictionary }) {
  return (
    <div className="privacy-body wrap">
      <div className="permission-grid">
        {d.privacy.items.map((s, i) => (
          <section key={s.title}>
            <span className="small-index">0{i + 1}</span>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
          </section>
        ))}
      </div>
      <div className="privacy-notes">
        <section>
          <h2>{d.privacy.storageTitle}</h2>
          <p>{d.privacy.storage}</p>
        </section>
        <section>
          <h2>{d.privacy.websiteTitle}</h2>
          <p>{d.privacy.website}</p>
        </section>
      </div>
    </div>
  );
}
function FAQ({ d }: { d: Dictionary }) {
  return (
    <div className="faq-list wrap">
      {d.faq.items.map((item, i) => (
        <details key={item.q} open={i === 0}>
          <summary>
            <span className="small-index">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h2>{item.q}</h2>
            <span className="faq-toggle" aria-hidden="true" />
          </summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}
function Changelog({ locale, d }: { locale: Locale; d: Dictionary }) {
  return (
    <div className="changelog-layout wrap">
      <aside className="margin-note">
        <p className="eyebrow">{d.common.latest}</p>
        <strong className="latest-number">v{version}</strong>
        <a className="text-link" href={`/${locale}/feed.xml`}>
          {d.common.rss}
          <Arrow />
        </a>
      </aside>
      <div className="release-list">
        {d.releases.map((r, i) => (
          <article key={r.version} id={`v${r.version}`}>
            <span className="release-version">
              v{r.version}
              {i === 0 && <span className="latest-dot" />}
            </span>
            <h2>{r.title}</h2>
            <ul>
              {r.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </article>
        ))}
        {locale === "zh" ? (
          <details className="historical" id="history">
            <summary>
              {d.common.original}
              <span aria-hidden="true">＋</span>
            </summary>
            {history
              .filter(
                (r) => !d.releases.some((local) => local.version === r.version),
              )
              .map((r) => (
                <article key={r.version} id={`v${r.version}`} lang="zh-CN">
                  <span className="release-version">v{r.version}</span>
                  <h2>{r.headline || r.summary}</h2>
                  <ul>
                    {r.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </article>
              ))}
          </details>
        ) : (
          <Link
            className="text-link"
            href="/zh/changelog#history"
            hrefLang="zh-CN"
          >
            {d.common.original}
            <Arrow />
          </Link>
        )}
      </div>
    </div>
  );
}
export function SitePage({
  locale,
  section,
}: {
  locale: Locale;
  section: Section;
}) {
  const d = dictionaries[locale];
  return (
    <>
      <Header locale={locale} section={section} d={d} />
      <main id="main">
        {!section ? (
          <Home locale={locale} d={d} />
        ) : (
          <>
            <PageHeading locale={locale} section={section} d={d} />
            {section === "features" && <Features d={d} />}
            {section === "guide" && <Guide locale={locale} d={d} />}
            {section === "download" && <Download d={d} />}
            {section === "privacy" && <Privacy d={d} />}
            {section === "faq" && <FAQ d={d} />}
            {section === "changelog" && <Changelog locale={locale} d={d} />}
            <Related
              locale={locale}
              d={d}
              sections={
                section === "download"
                  ? ["guide", "faq"]
                  : section === "privacy"
                    ? ["faq", "download"]
                    : ["download", "privacy"]
              }
            />
          </>
        )}
      </main>
      <Footer locale={locale} d={d} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData(locale, section)).replace(
            /</g,
            "\\u003c",
          ),
        }}
      />
    </>
  );
}
