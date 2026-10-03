// ログインを切らさない（2026-10-03 社長「定期的にエラーが出てログインし直さないといけない」）。
//
// ライブ画面のように何時間も開いたままの画面は、ページを移動せず API を 5〜10 秒ごとに呼ぶだけになる。
// これまでログインの更新（アクセストークンの取り直し）はサーバ側（middleware の getUser）だけが担っており、
// 期限が切れた瞬間に複数のポーリングが同時に更新を試みる形だった。本番では配信中にログインが切れ、
// 以後のポーリングが全部ログイン画面へ転送されていた（2026-10-03 の wrangler tail: live/poll が 10 秒ごとに 307 → /login）。
// ブラウザ側で期限より前に更新しておけば、サーバは常に有効なトークンを受け取り、更新の取り合いが起きない。
// supabase-js の自動更新はタブが裏にあると止まるため、1 分ごと・タブが前面に戻ったとき・通信が戻ったときに自分で確かめる。

import { createClient } from "@/lib/supabase/client";

/** 何分ごとにログインの期限を確かめるか（裏のタブでもブラウザは 1 分に 1 回はタイマーを動かす） */
export const SESSION_CHECK_MS = 60_000;
/** 期限のこれだけ前になったら取り直す（アクセストークンは 1 時間。サーバ側は期限切れ間際に更新するので、それより十分前） */
export const REFRESH_BEFORE_MS = 10 * 60_000;

/** 純関数: いまログインを取り直すべきか（expiresAtSec は Supabase の session.expires_at・秒） */
export function needsRefresh(expiresAtSec: number | null | undefined, nowMs: number): boolean {
  if (typeof expiresAtSec !== "number" || !Number.isFinite(expiresAtSec)) return false;
  return expiresAtSec * 1000 - nowMs < REFRESH_BEFORE_MS;
}

/** 純関数: API の応答が「ログインが切れている」を表すか（401、または旧版のログイン画面への転送） */
export function isLoginExpiredResponse(res: Pick<Response, "status" | "redirected" | "url">): boolean {
  if (res.status === 401) return true;
  if (!res.redirected || !res.url) return false;
  try {
    return new URL(res.url).pathname.startsWith("/login");
  } catch {
    return false;
  }
}

/** 期限が近ければ取り直す。失敗しても投げない（次の確認でやり直す） */
export async function refreshSessionIfNeeded(): Promise<void> {
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (session && needsRefresh(session.expires_at, Date.now())) await supabase.auth.refreshSession();
  } catch {
    // 通信が切れている等。次の確認でやり直す
  }
}

/** いますぐ取り直す（API が 401 を返したとき）。取り直せたら true */
export async function refreshSessionNow(): Promise<boolean> {
  try {
    const { data, error } = await createClient().auth.refreshSession();
    return !error && Boolean(data.session);
  } catch {
    return false;
  }
}
