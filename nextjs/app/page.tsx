import Link from "next/link";
import { site, features, steps, compat, faqs, plain } from "./content";
import { RichText } from "./rich-text";
import releases from "./releases.json";

/** FAQPage 结构化数据:与页面上的问答同源,避免两处文案漂移 */
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: plain(f.a) },
  })),
};

const latest = releases.slice(0, 3);

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      {/* ===== 顶部导航 ===== */}
      <nav className="nav">
        <div className="container nav-inner">
          <a className="nav-logo" href="#top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="nav-logo-img" src="/assets/logo.png" alt="KoiTab logo" />
            <span>KoiTab</span>
          </a>
          <div className="nav-links">
            <a href="#features">功能</a>
            <a href="#how">使用方法</a>
            <a href="#compat">兼容性</a>
            <a href="#faq">常见问题</a>
          </div>
          <a className="btn btn-small btn-primary" href="#download">获取插件</a>
        </div>
      </nav>

      {/* ===== Hero ===== */}
      <header className="hero" id="top">
        <div className="container hero-inner">
          <div className="hero-copy">
            <span className="hero-badge">{site.repoNote}</span>
            <h1>
              让杂乱的标签页,
              <br />
              <span className="grad">一键变得井井有条</span>
            </h1>
            <p className="hero-sub">
              KoiTab 是一款轻量的浏览器标签页整理助手:点一下「一键整理」,
              自动关掉重复网页、把相同网站合并成组,多窗口也能一起收拾干净;
              很久没用的页面还能一键收进 KoiTab 收藏夹再关闭,想找随时能回来。
            </p>
            <div className="hero-actions" id="download">
              <a className="btn btn-primary" href={site.downloadPath} download>
                ⬇️ 下载 KoiTab（Chrome / Edge 通用）
              </a>
              <a className="btn btn-ghost" href="#features">了解功能</a>
            </div>
            <p className="hero-note">无需注册 · 不上传任何数据 · Manifest V3</p>
          </div>

          {/* 弹窗预览 mock */}
          <div className="hero-mock" aria-hidden="true">
            <div className="mock-popup">
              <div className="mock-head">
                <strong>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="mock-logo" src="/assets/logo.png" alt="" />
                  KoiTab
                </strong>
                <span className="mock-search">搜索标签页…</span>
              </div>
              <div className="mock-actions">
                <span className="mock-btn mock-btn-primary">⚡ 一键整理</span>
              </div>
              <div className="mock-group">
                <div className="mock-group-head">
                  <b className="mock-caret">▾</b>
                  <i style={{ "--c": "#3b82f6" } as React.CSSProperties} />
                  github.com <em>5</em>
                </div>
                <div className="mock-row">🔧 koitab · feature/tabs</div>
                <div className="mock-row">🐛 issue #128 · group API</div>
                <div className="mock-row dim">📦 releases · v1.0.0</div>
              </div>
              <div className="mock-group">
                <div className="mock-group-head">
                  <b className="mock-caret">▾</b>
                  <i style={{ "--c": "#f59e0b" } as React.CSSProperties} />
                  docs.google.com <em>3</em>
                </div>
                <div className="mock-row">📄 KoiTab 产品需求文档</div>
                <div className="mock-row dim">📊 数据看板</div>
              </div>
              <div className="mock-group">
                <div className="mock-group-head">
                  <b className="mock-caret is-collapsed">▾</b>
                  <i style={{ "--c": "#ec4899" } as React.CSSProperties} />
                  bilibili.com <em>2</em>
                </div>
                <div className="mock-row mock-preview">
                 🎬 【摸鱼】今日推荐视频<span className="mock-more">等 2 个</span>
                </div>
              </div>
              <div className="mock-group">
                <div className="mock-group-head">
                  <b className="mock-caret is-collapsed">▾</b>
                  <i style={{ "--c": "#10b981" } as React.CSSProperties} />
                  stackoverflow.com <em>12</em>
                </div>
                <div className="mock-row mock-preview">
                  ❓ Chrome tabGroups API 用法<span className="mock-more">等 12 个</span>
                </div>
              </div>
              <div className="mock-stat">28 个标签页 · 3 个站点 · 2 个重复</div>
            </div>
          </div>
        </div>
      </header>

      {/* ===== 功能 ===== */}
      <section className="section" id="features">
        <div className="container">
          <h2 className="section-title">核心功能</h2>
          <p className="section-sub">一个小弹窗,搞定标签栏的全部混乱</p>
          <div className="grid-3">
            {features.map((f) => (
              <article className="card" key={f.title}>
                <div className="card-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p><RichText text={f.body} /></p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 使用方法 ===== */}
      <section className="section section-alt" id="how">
        <div className="container">
          <h2 className="section-title">三步开始使用</h2>
          <p className="section-sub">支持 Chrome 与 Edge,下载即用 —— 无需应用商店</p>
          <div className="steps">
            {steps.map((s, i) => (
              <div className="step" key={s.title}>
                <span className="step-num">{i + 1}</span>
                <h3>{s.title}</h3>
                <p><RichText text={s.body} /></p>
              </div>
            ))}
          </div>
          <div className="tip">
            💡 建议把 KoiTab 图标固定到工具栏:点击浏览器地址栏右侧的拼图图标 🧩,把 KoiTab 钉住,随手就能整理。
          </div>
        </div>
      </section>

      {/* ===== 更新日志(内容新鲜度 + RSS 落地页) ===== */}
      <section className="section" id="changes">
        <div className="container">
          <h2 className="section-title">最近更新</h2>
          <p className="section-sub">
            想第一时间收到新版本?订阅 <a href="/feed.xml">RSS</a>,或查看<Link href="/changelog">完整更新日志</Link>
          </p>
          <div className="changelog">
            {latest.map((r) => (
              <article className="release" key={r.version} id={`v${r.version}`}>
                <h3>
                  v{r.version}
                  {r.headline ? <span className="release-tag">{r.headline}</span> : null}
                </h3>
                <ul>
                  {r.notes.slice(0, 4).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 兼容性 ===== */}
      <section className="section section-alt" id="compat">
        <div className="container">
          <h2 className="section-title">浏览器兼容性</h2>
          <p className="section-sub">基于 Chromium Manifest V3 打造,主流浏览器开箱即用</p>
          <div className="compat-grid">
            {compat.map((c) => (
              <div className="compat-card" key={c.title}>
                <span className="compat-logo">{c.icon}</span>
                <h3>{c.title}</h3>
                <p>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="section" id="faq">
        <div className="container container-narrow">
          <h2 className="section-title">常见问题</h2>
          {faqs.map((f, i) => (
            <details className="faq-item" key={f.q} open={i === 0}>
              <summary>{f.q}</summary>
              <p><RichText text={f.a} /></p>
            </details>
          ))}
        </div>
      </section>

      {/* ===== CTA / Footer ===== */}
      <footer className="footer">
        <div className="container">
          <h2>现在,给标签栏减个负</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="footer-logo" src="/assets/logo.png" alt="" aria-hidden="true" />
          <a className="btn btn-primary btn-large" href={site.downloadPath} download>
            ⬇️ 下载 KoiTab 扩展
          </a>
          <p className="footer-note">
            KoiTab © {new Date().getFullYear()} · 为效率而生 ·{" "}
            <Link href="/changelog">更新日志</Link> · <a href="/feed.xml">RSS</a>
          </p>
        </div>
      </footer>
    </>
  );
}
