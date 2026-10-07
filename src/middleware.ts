import { type NextRequest, NextResponse } from "next/server";
import { applyCorsHeaders, isAllowedAppOrigin } from "@/lib/cors";
import { updateSession } from "@/lib/supabase/middleware";
import { isSyncRoutePath } from "@/lib/sync-routes";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // スマホアプリ（Capacitor の WebView。Origin は https://localhost / capacitor://localhost）からの API 呼び出し（2026-10-07）:
  // 許可した Origin なら応答に CORS ヘッダーを付け、事前確認（OPTIONS）はここで 204 を返す（API ルートに OPTIONS は無く、Supabase にも行かない）。
  // アプリは Cookie ではなく Authorization: Bearer でログインを渡す（src/lib/supabase/server.ts）。許可リストに無い Origin には何も付けない
  const origin = request.headers.get("origin");
  const cors = pathname.startsWith("/api/") && isAllowedAppOrigin(origin);
  if (cors && request.method === "OPTIONS") {
    const preflight = new NextResponse(null, { status: 204 });
    applyCorsHeaders(preflight.headers, origin!);
    return preflight;
  }

  // X-Sync-Key で保護する「サーバ間呼び出し専用」ルート（cron 等）は認証を素通しする。
  // 認証はルート側の共有キー検証で行う。対象は src/lib/sync-routes.ts の SYNC_ROUTES が
  // 唯一の定義元 — ここでは判定するだけで、パスの列挙は持たない（更新箇所を 1 か所にするため。
  // matcher の個別除外は廃止した。matcher が拾っても、この判定が updateSession より必ず先に効く）。
  // ログイン済みでトップ（/）に来たときのダッシュボードへの転送も updateSession が行う（2026-10-03。理由は同ファイル）
  const response = isSyncRoutePath(pathname) ? NextResponse.next() : await updateSession(request);
  if (cors) applyCorsHeaders(response.headers, origin!);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js).*)",
  ],
};
