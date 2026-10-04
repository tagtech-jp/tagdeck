// ログインを切らさない（2026-10-03 社長「定期的にエラーが出てログインし直さないといけない」）。
//
// ライブ画面のように何時間も開いたままの画面は、ページを移動せず API を 5〜10 秒ごとに呼ぶだけになる。
// アクセストークン（1 時間）は期限より前に取り直しておかないと、期限の瞬間にログインが切れる。
//
// 取り直しはサーバ（/api/auth/refresh。Cloudflare Workers → Supabase）だけが行い、新しいトークンは Set-Cookie で返す。
// ブラウザは Supabase に取り直しを頼まない。
// - SessionKeeper とライブ画面は、この窓口を直接呼ぶ（このファイル）
// - ブラウザの supabase-js が自分で取り直そうとしたとき（スリープ明けに期限が切れていた等）も、fetch を差し替えて
//   Supabase ではなくこの窓口へ回す。自動の取り直し（autoRefreshToken）も切る（src/lib/supabase/client.ts）
// これで「ログインし直し」が要るのは、自分でログアウトしたとき・Cookie を消したときだけになる
// （Supabase の更新トークンには期限が無く、ログイン Cookie は 400 日。取り直すたびに 400 日へ延びる）。
// 理由（2026-10-03 本番）: PR #74 でブラウザの supabase-js に期限 10 分前の refreshSession() をさせたところ、
// 再ログインから約 50 分後（その取り直しの時刻）に live/poll が 401 になり、以後ずっと 401 だった。
// - Supabase の Auth ログには取り直しの要求（POST /token）が 1 件も届いていない
// - 401 の応答は 5 ミリ秒（Supabase へ問い合わせる前に「ログイン Cookie が無い」と判定）＝ブラウザ側で Cookie が消えていた
// supabase-js はブラウザからの取り直しが「再試行できない」エラーで終わると、その場でログイン Cookie を消す（_removeSession）。
// ブラウザ → Supabase の取り直しは、失敗した理由がこちらからは見えない（Auth ログにも残らない）まま、ログインごと消える。
// サーバ → Supabase の取り直しは、ログイン時のコード交換（/auth/callback）と同じ経路で、結果は wrangler tail で見える。

/** 何ミリ秒ごとにログインの期限を確かめるか（裏のタブでもブラウザは 1 分に 1 回はタイマーを動かす） */
export const SESSION_CHECK_MS = 60_000;
/** 期限のこれだけ前になったら取り直す（アクセストークンは 1 時間。middleware の getUser は期限 90 秒前から更新するので、それより十分前） */
export const REFRESH_BEFORE_MS = 10 * 60_000;
/** ログインの取り直しを頼むサーバの窓口（src/app/api/auth/refresh/route.ts） */
export const SESSION_REFRESH_PATH = "/api/auth/refresh";

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

/**
 * 純関数: 届いた Cookie の名前から、ログイン Cookie の状態を短く表す（wrangler tail の診断用。値は出さない）。
 * Supabase のログイン Cookie は `sb-<プロジェクト>-auth-token`。長いと `.0` `.1` … に分割される
 */
export function describeAuthCookies(names: readonly string[]): string {
  const parts = names.flatMap((n) => {
    const m = /-auth-token(?:\.(\d+))?$/.exec(n);
    return m ? [m[1] ?? "分割なし"] : [];
  });
  const verifier = names.some((n) => n.endsWith("-auth-token-code-verifier"));
  return `ログイン Cookie=${parts.length ? parts.join(",") : "なし"}${verifier ? "・code-verifier あり" : ""}・Cookie 総数=${names.length}`;
}

const postRefresh = () => fetch(SESSION_REFRESH_PATH, { method: "POST", credentials: "same-origin", cache: "no-store" });

/** 期限が近ければサーバに取り直してもらう（近いかどうかはサーバが判断する）。失敗しても投げない（次の確認でやり直す） */
export async function refreshSessionIfNeeded(): Promise<void> {
  try {
    const res = await postRefresh();
    void res.body?.cancel();
  } catch {
    // 通信が切れている等。次の確認でやり直す
  }
}

/**
 * API が 401 を返したときに呼ぶ。サーバでログインが生きているか確かめ、期限が近ければ取り直してもらう。
 * ログインが生きていれば true（呼んだ側は 1 回だけ送り直す）
 */
export async function refreshSessionNow(): Promise<boolean> {
  try {
    const res = await postRefresh();
    if (!res.ok) {
      void res.body?.cancel();
      return false;
    }
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    return body?.ok === true;
  } catch {
    return false;
  }
}
