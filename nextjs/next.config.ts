import type { NextConfig } from "next";

/**
 * 纯静态预渲染(SSG):所有页面在构建时就产出完整 HTML。
 * 对营销站来说,SSG 的 SEO 效果与 SSR 完全一致,但首屏更快、Workers 请求成本为零
 * (静态资源直接由 Cloudflare 边缘返回,不进 Worker 计算)。
 * 没有 dynamic API、没有数据库,因此不需要 ISR/SSR。
 */
const nextConfig: NextConfig = {
  trailingSlash: false,
  poweredByHeader: false,
  // 搜索引擎看到的是干净的 HTML,不需要额外的运行时
  reactStrictMode: true,
};

export default nextConfig;
