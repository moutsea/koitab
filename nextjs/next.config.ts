import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  trailingSlash: false,
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/", destination: "/zh", permanent: true },
      { source: "/changelog", destination: "/zh/changelog", permanent: true },
      { source: "/feed.xml", destination: "/zh/feed.xml", permanent: true },
    ];
  },
};
export default nextConfig;
