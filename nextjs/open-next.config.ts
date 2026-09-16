import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext 的 Cloudflare 适配器配置。
 * 本站是纯 SSG,不需要增量缓存 / 队列等能力,保持最小配置即可。
 */
export default defineCloudflareConfig({});
