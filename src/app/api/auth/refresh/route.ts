import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { describeAuthCookies, needsRefresh } from "@/lib/auth/session-refresh";

/**
 * POST /api/auth/refresh → ログインの取り直しをサーバ側で行う（2026-10-03）
 * - 呼ぶのはブラウザの SessionKeeper（1 分ごと・前面復帰・通信復帰）と、ライブ画面が 401 を受けたとき（?force=1）
 * - 期限まで 10 分を切っていれば（force なら常に）Supabase に取り直しを頼み、新しいトークンを Set-Cookie で返す
 *   （server.ts の createClient が cookies() に書く。Route Handler なので応答に載る）
 * - ブラウザの supabase-js には取り直しをさせない。理由と経緯は src/lib/auth/session-refresh.ts
 * - 返すのは成否と期限（秒）だけ。トークンや利用者の情報は返さない。ログイン Cookie が無ければ 401
 * - 応答:
 *   - 200 { ok: true, refreshed, expires_at }
 *   - 401 { ok: false, reason }（ログインが無い・取り直しを断られた）
 *   - 503 { ok: false, reason: "retryable" }（通信の一時的な失敗。次の確認でやり直す）
 * - 失敗と取り直しの結果は console に 1 行出す（wrangler tail で見る。トークンは出さない）
 */
export async function POST(request: Request): Promise<NextResponse> {
  const force = new URL(request.url).searchParams.get("force") === "1";
  const supabase = await createClient();
  // getSession は Cookie を読むだけ（期限 90 秒前を切っていれば supabase-js がその場で取り直す）。
  // 利用者の確認は middleware の getUser が済ませている。ここで使うのは期限（expires_at）だけ
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    if (error) return failed("getSession", error);
    const names = (await cookies()).getAll().map((c) => c.name);
    console.warn(`[auth/refresh] ログインなし（${describeAuthCookies(names)}）`);
    return noStore(NextResponse.json({ ok: false, reason: "no_session" }, { status: 401 }));
  }
  const leftSec = typeof session.expires_at === "number" ? Math.round(session.expires_at - Date.now() / 1000) : null;
  if (!force && !needsRefresh(session.expires_at, Date.now())) {
    return noStore(NextResponse.json({ ok: true, refreshed: false, expires_at: session.expires_at ?? null }));
  }
  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error || !refreshed.data.session) return failed("refreshSession", refreshed.error);
  console.log(`[auth/refresh] 取り直した（残り ${leftSec ?? "?"} 秒の時点${force ? "・401 を受けて" : ""}）`);
  return noStore(NextResponse.json({ ok: true, refreshed: true, expires_at: refreshed.data.session.expires_at ?? null }));
}

type AuthErrorLike = { name?: string; status?: number; code?: string; message?: string } | null;

function failed(step: string, error: AuthErrorLike): NextResponse {
  const status = typeof error?.status === "number" ? error.status : null;
  // 通信の失敗（status 0）と Supabase 側の 5xx は一時的。ログイン Cookie は supabase-js が残している
  const retryable = error?.name === "AuthRetryableFetchError" || status === 0 || (status !== null && status >= 500);
  console.warn(
    `[auth/refresh] ${step} 失敗: name=${error?.name ?? "-"} status=${status ?? "-"} code=${error?.code ?? "-"} message=${(error?.message ?? "").slice(0, 120)}`,
  );
  if (retryable) return noStore(NextResponse.json({ ok: false, reason: "retryable" }, { status: 503 }));
  return noStore(NextResponse.json({ ok: false, reason: error?.code ?? "refresh_failed" }, { status: 401 }));
}

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
