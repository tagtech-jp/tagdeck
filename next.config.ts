import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  // 音源（public/se/**・自動ライブラリ 285 本 ≒ 12MB ＋ 既定 2MB）は事前キャッシュに入れない（2026-09-29）。
  // globPublicPatterns の "!" 否定は glob が解釈しないため効かない（本番 sw.js に 305 本入った実害）。
  // manifestTransforms で /se/ 配下の項目を落とす。鳴らす直前に取得し、runtimeCaching の static-audio-assets（CacheFirst）に載る
  manifestTransforms: [
    async (entries) => ({ manifest: entries.filter((e) => !/\/se\/(lib|defaults)\//.test(String(e.url))), warnings: [] }),
  ],
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
