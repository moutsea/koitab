#!/usr/bin/env python3
"""为 Next.js 官网(koitab.com)准备发布产物。

做三件事:
  1. 解析仓库根部的 CHANGELOG.md -> nextjs/app/releases.json
     (页面「最近更新」、/changelog、RSS feed 三处共用这一份数据)
  2. 打包 extension/ -> nextjs/public/downloads/koitab-latest.zip(+ 版本号命名的副本)
     顶层是 koitab/ 文件夹,解压后直接「加载已解压的扩展程序」;
     排除开发用的 debug.html / debug.js
  3. 自检:releases.json 可解析、zip 结构正确、下载链接指向的文件存在

用法:
  python3 tools/build-site.py               # 只准备产物(快)
  python3 tools/build-site.py --with-build  # 准备后顺带跑一次 next build 验证
之后部署(在 nextjs/ 目录):
  npm ci && npm run deploy                  # opennextjs-cloudflare build + deploy 到 Workers
"""
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "nextjs")
PUBLIC_DOWNLOADS = os.path.join(APP, "public", "downloads")
RELEASES_JSON = os.path.join(APP, "app", "releases.json")
CHANGELOG = os.path.join(ROOT, "CHANGELOG.md")
EXCLUDE = {"debug.html", "debug.js", ".DS_Store"}
MAX_RELEASES = 40          # feed / changelog 页保留的版本数
MAX_NOTES = 12             # 单版本最多保留的条目数


def strip_md(text: str) -> str:
    """去掉 markdown 标记,留纯文本(JSON-LD / RSS / 列表都用它)"""
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)   # 链接
    text = text.replace("**", "").replace("`", "")
    return text.strip()


def parse_changelog() -> list[dict]:
    raw = open(CHANGELOG, encoding="utf-8").read()
    # 以 "## x.y.z" 切分;第一段是文件头,丢弃
    parts = re.split(r"^##\s+(\d+\.\d+\.\d+)\s*$", raw, flags=re.MULTILINE)
    releases = []
    for i in range(1, len(parts) - 1, 2):
        version, body = parts[i], parts[i + 1]
        lines = [ln.rstrip() for ln in body.strip().splitlines()]
        summary, notes = "", []
        for ln in lines:
            s = ln.strip()
            if not s:
                continue
            if s.startswith("- "):
                note = strip_md(s[2:])
                if note:
                    notes.append(note)
            elif s.startswith("#"):          # 旧版本里的 #### 小标题
                continue
            elif not summary:
                summary = strip_md(s)
        # 版本标签:优先取摘要里的加粗短语(短的才配当标签)
        m = re.search(r"\*\*(.+?)\*\*", body)
        headline = strip_md(m.group(1)) if m else ""
        if len(headline) > 14:
            headline = headline[:14] + "…"
        releases.append({
            "version": version,
            "summary": summary,
            "headline": headline,
            "notes": notes[:MAX_NOTES],
        })
    return releases[:MAX_RELEASES]


def write_releases(version: str):
    releases = parse_changelog()
    assert releases, "CHANGELOG 解析为空,检查格式(需要 '## x.y.z' 标题)"
    assert releases[0]["version"] == version, (
        f"CHANGELOG 最新版本 {releases[0]['version']} 与 manifest 的 {version} 不一致")
    with open(RELEASES_JSON, "w", encoding="utf-8") as f:
        json.dump(releases, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"releases.json  {len(releases)} 个版本 · 最新 v{releases[0]['version']}"
          f" · {len(releases[0]['notes'])} 条要点")


def make_zip(version: str):
    os.makedirs(PUBLIC_DOWNLOADS, exist_ok=True)
    # 清掉历史版本的 zip:只留当前版本 + koitab-latest,避免仓库与部署包越堆越大
    for stale in sorted(os.listdir(PUBLIC_DOWNLOADS)):
        if stale.startswith("koitab-v") and stale.endswith(".zip") \
                and stale != f"koitab-v{version}.zip":
            os.remove(os.path.join(PUBLIC_DOWNLOADS, stale))
            print(f"  清理历史包 {stale}")
    ext_dir = os.path.join(ROOT, "extension")
    files = []
    for base, _, names in os.walk(ext_dir):
        for n in names:
            if n in EXCLUDE or n.startswith("."):
                continue
            full = os.path.join(base, n)
            files.append((full, os.path.join("koitab", os.path.relpath(full, ext_dir))))

    for name in (f"koitab-v{version}.zip", "koitab-latest.zip"):
        path = os.path.join(PUBLIC_DOWNLOADS, name)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for full, arc in sorted(files):
                z.write(full, arc)
        print(f"downloads/{name}  {os.path.getsize(path):,} bytes · {len(files)} 个文件")


def check(version: str):
    releases = json.load(open(RELEASES_JSON, encoding="utf-8"))
    assert releases[0]["version"] == version
    latest = os.path.join(PUBLIC_DOWNLOADS, "koitab-latest.zip")
    assert os.path.exists(latest), "缺少 koitab-latest.zip"
    with zipfile.ZipFile(latest) as z:
        names = z.namelist()
        assert "koitab/manifest.json" in names, "zip 里应有 koitab/manifest.json"
        assert not any("debug." in n for n in names), "开发用诊断页不该进发布包"
        inner = json.loads(z.read("koitab/manifest.json").decode())
        assert inner["version"] == version, "zip 内 manifest 版本与仓库不一致"
    for f in ("app/page.tsx", "app/changelog/page.tsx", "app/feed.xml/route.ts",
              "app/sitemap.ts", "app/robots.ts", "wrangler.jsonc"):
        assert os.path.exists(os.path.join(APP, f)), f"缺少 {f}"
    print(f"  ✅ 自检通过:v{version} · releases.json / zip / 站点文件齐备")


def run_build():
    # 已知坑:如果外层 shell 带着 NODE_ENV=development(部分工具链会这样),
    # next build 会在预渲染 /_global-error 时崩在 "useContext of null"
    # (vercel/next.js#97046)。构建期强制 production,与代码无关的失败就此绕开。
    env = {**os.environ, "NODE_ENV": "production"}
    print("\n$ NODE_ENV=production npm run build")
    r = subprocess.run(["npm", "run", "build"], cwd=APP, env=env)
    if r.returncode != 0:
        sys.exit("next build 失败")


def main():
    version = json.load(open(os.path.join(ROOT, "extension", "manifest.json"),
                            encoding="utf-8"))["version"]
    print(f"KoiTab v{version} —— 准备官网产物\n")
    write_releases(version)
    make_zip(version)
    check(version)
    if "--with-build" in sys.argv:
        run_build()
    print("\n下一步(在 nextjs/ 目录):")
    print("  npm ci          # 首次")
    print("  npm run dev     # 本地预览 http://localhost:3000")
    print("  npm run deploy  # opennextjs-cloudflare build + deploy 到 Cloudflare Workers")


if __name__ == "__main__":
    main()