import type { Metadata } from "next";
import Link from "next/link";
import { site } from "../content";
import releases from "../releases.json";

export const metadata: Metadata = {
  title: "更新日志",
  description: `${site.name} 的全部版本更新记录:功能、修复与调整。当前最新版本 v${releases[0]?.version ?? "0.0.0"}。`,
  alternates: { canonical: "/changelog" },
  openGraph: {
    type: "article",
    url: `${site.url}/changelog`,
    title: `${site.name} 更新日志`,
    description: `${site.name} 的全部版本更新记录。`,
  },
};

export default function Changelog() {
  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <Link className="nav-logo" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="nav-logo-img" src="/assets/logo.png" alt="KoiTab logo" />
            <span>KoiTab</span>
          </Link>
          <div className="nav-links">
            <Link href="/">首页</Link>
            <a href="/feed.xml">RSS</a>
          </div>
          <a className="btn btn-small btn-primary" href={site.downloadPath} download>
            获取插件
          </a>
        </div>
      </nav>

      <section className="section">
        <div className="container container-narrow">
          <h1 className="section-title">更新日志</h1>
          <p className="section-sub">
            共 {releases.length} 个版本 · 订阅 <a href="/feed.xml">RSS</a> 获取更新
          </p>
          <div className="changelog">
            {releases.map((r) => (
              <article className="release" key={r.version} id={`v${r.version}`}>
                <h3>
                  v{r.version}
                  {r.headline ? <span className="release-tag">{r.headline}</span> : null}
                </h3>
                {r.summary ? <p className="release-summary">{r.summary}</p> : null}
                {r.notes.length ? (
                  <ul>
                    {r.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
          <p style={{ marginTop: 32 }}>
            <Link className="btn btn-ghost" href="/">← 回到首页</Link>
          </p>
        </div>
      </section>
    </>
  );
}
