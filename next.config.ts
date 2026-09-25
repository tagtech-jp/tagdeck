import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: false,
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      // 攻略（AI接客カンペ）ページは 2026-09-25 に廃止。旧 URL・ブックマークはイベントへ送る
      { source: "/ai-prompter", destination: "/events", permanent: true },
    ];
  },
};

export default withSerwist(nextConfig);
