import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { securityHeaderRules } from "./src/lib/security-headers";

/**
 * public/ の事前キャッシュ一覧を自前で作る（2026-09-29）。
 * @serwist/next は globPublicPatterns の "!" 否定を解釈せず（glob v10 は否定パターン非対応）、manifestTransforms も
 * additionalPrecacheEntries には掛からないため、音源（public/se/**・約 14MB）を除外するにはこの一覧を渡すしかない。
 * 除外: se/**（音源。鳴らす直前に取得し runtimeCaching の static-audio-assets に載る）、sw.js・swe-worker-*.js（Serwist 自身）
 */
function publicPrecacheEntries(): Array<{ url: string; revision: string }> {
  const root = join(process.cwd(), "public");
  const out: Array<{ url: string; revision: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const rel = relative(root, full).split("\\").join("/");
      if (rel === "se" || rel.startsWith("se/")) continue;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/^sw\.js(\.map)?$/.test(rel) || /^swe-worker-.*\.js$/.test(rel)) continue;
      out.push({ url: `/${rel}`, revision: createHash("md5").update(readFileSync(full)).digest("hex") });
    }
  };
  try {
    walk(root);
  } catch {
    // public/ が無ければ空
  }
  return out;
}

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  // 音源（public/se/**・自動ライブラリ 285 本 ≒ 12MB ＋ 既定 2MB）は事前キャッシュに入れない（2026-09-29）。
  // globPublicPatterns の "!" 否定も manifestTransforms も効かなかった（本番 sw.js に 305 本入った実害・PR #47/#48）ので、
  // public/ の一覧を自前で作って渡す（additionalPrecacheEntries があれば @serwist/next は glob をしない）
  additionalPrecacheEntries: publicPrecacheEntries(),
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: false,
  // x-powered-by: Next.js を出さない（2026-10-08 セキュリティ監査。実装の種類を無駄に知らせない）
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  // Worker が返す全応答（ページ・API）にセキュリティ関連ヘッダーを付ける（2026-10-08）。値と理由は src/lib/security-headers.ts。
  // Cloudflare が Worker の手前で配る静的アセットには効かないので、同じ値を public/_headers にも書いてある
  async headers() {
    return securityHeaderRules();
  },
  async redirects() {
    return [
      // 攻略（AI接客カンペ）ページは 2026-09-25 に廃止。旧 URL・ブックマークはイベントへ送る
      { source: "/ai-prompter", destination: "/events", permanent: true },
    ];
  },
};

export default withSerwist(nextConfig);
