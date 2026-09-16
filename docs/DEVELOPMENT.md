# 开发与发布

## 目录

- `extension/`：Manifest V3 扩展，原生 HTML / CSS / JS，无第三方运行依赖。
- `nextjs/`：官网，Next.js App Router 静态预渲染，部署到 Cloudflare Workers。
- `tests/`：隔离的 Chrome API 回归测试，不操作真实标签或收藏。
- `tools/`：发布打包、页面检查、图标和截图预览工具。

## 本地运行

插件：在 Chrome / Edge 的扩展管理页开启开发者模式，加载 `extension/`。修改后点击扩展的刷新按钮。

官网：

```bash
cd nextjs
npm ci
npm run dev
```

浏览器最低版本为 Chrome / Edge 121。扩展使用 `tabs`、`tabGroups`、`bookmarks`、`storage` 四个权限；书签只读，归档和设置保存在 `chrome.storage.local`。

## 文案和截图

- 扩展五语文案：`extension/locales/{zh,en,ja,ko,la}.json`；浏览器原生名称与描述：`extension/_locales/`。
- 官网五语文案：`nextjs/locales/`；各语言有首页、功能、指南、下载、隐私、问答、更新日志七个页面。
- 官网截图：`nextjs/public/screenshots/`；图片尺寸记录：`nextjs/lib/screenshots.json`。
- 页面结构与样式：`nextjs/components/site-page.tsx`、`nextjs/app/globals.css`。

使用隔离数据预览真实扩展界面：

```bash
python3 tools/preview-extension.py
```

打开 `http://127.0.0.1:3200/popup.html?lang=zh&view=tabs`。`lang` 支持五种语言，`view` 可选 `ops`、`tabs`、`fav`。诊断页需点击「开始诊断」。预览仅替换浏览器 API 为示例数据，并选用插件自带的浅色主题；不访问真实浏览器数据。截图用浏览器生成，裁去窗口空白即可，不重绘界面。

## 验证

```bash
node --test tests/*.test.cjs
cd nextjs
npm run build:worker
```

Worker 构建依次运行扩展测试、生成下载包与版本记录、构建站点，并检查 35 页的语言、元数据、链接、站点地图和 RSS。脚本已强制生产构建环境。

## 发布

1. 更新 `extension/manifest.json` 的版本号（新功能升次版本，修复与文档更新升修订号）。
2. 更新根目录 `CHANGELOG.md`，并补齐五语官网 `releases` 的最新条目。
3. 运行 `npm run build:worker`，确认验证通过，提交生成的下载包与版本数据。
4. 推送到 GitHub `main`，Cloudflare Workers Builds 自动部署。

Cloudflare 构建根目录为 `nextjs`，构建命令 `npm run build:worker`，部署命令 `npm run deploy:worker`，Node 版本见 `nextjs/.node-version`。

`tools/build-site.py` 从 CHANGELOG 生成 `nextjs/app/releases.json`，打包扩展并附带 MIT 许可证，排除开发诊断页。`wrangler.jsonc` 配置 `koitab.com` 和 `www.koitab.com`；部署自己的副本时需替换 Worker 名称与域名。

## 图标

原图在 `assets/logo-source.jpg`。使用带 Pillow 的 Python 运行 `python3 tools/apply-logo.py` 可重新生成图标；`--preview` 生成主体比例对照图。
