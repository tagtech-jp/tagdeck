import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { updateSession } from "@/lib/supabase/middleware";
import { isSyncRoutePath } from "@/lib/sync-routes";

export async function middleware(request: NextRequest) {
  // X-Sync-Key で保護する「サーバ間呼び出し専用」ルート（cron 等）は認証を素通しする。
  // 認証はルート側の共有キー検証で行う。対象は src/lib/sync-routes.ts の SYNC_ROUTES が
  // 唯一の定義元 — ここでは判定するだけで、パスの列挙は持たない（更新箇所を 1 か所にするため。
  // matcher の個別除外は廃止した。matcher が拾っても、この判定が updateSession より必ず先に効く）。
  if (isSyncRoutePath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname === "/") {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => request.cookies.getAll(), setAll: () => {} } }
    );
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|sw.js).*)",
  ],
};
