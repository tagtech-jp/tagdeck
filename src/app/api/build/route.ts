import { NextResponse } from "next/server";

/**
 * GET /api/build → いま動いている Worker のビルド識別子。
 * ブラウザ側（BuildGuard）は自分のバンドルに埋め込まれた値と突き合わせ、食い違えば
 * Service Worker が古い JS を配っていると判断して更新を促す（2026-09-25 のログイン障害の再発防止）。
 * 認証不要（値は公開して問題ないコミット SHA）。キャッシュはさせない
 */
export async function GET() {
  const res = NextResponse.json({ buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown" });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
