import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { Session, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { describeAuthCookies, needsRefresh } from "@/lib/auth/session-refresh";

/**
 * POST /api/auth/refresh → ログインの取り直しをサーバ側で行う（2026-10-03）
 * - 呼ぶのは 3 か所。どれも同じサイトのブラウザから
 *   - SessionKeeper（1 分ごと・前面復帰・通信復帰）
 *   - ライブ画面が 401 を受けたとき
 *   - ブラウザの supabase-js が取り直しをしようとしたとき（?format=gotrue。src/lib/supabase/client.ts の fetch が、
 *     Supabase へは送らずここへ回す。スリープ明けなどでトークンの期限が切れていた場合もこの道を通る）
 * - 期限まで 10 分を切っていれば Supabase に取り直しを頼み、新しいトークンを Set-Cookie で返す
 *   （server.ts の createClient が cookies() に書く。Route Handler なので応答に載る）
 * - 期限まで 10 分以上あれば取り直さない。同じ要求の middleware が取り直した直後に 2 回目をすると Set-Cookie が 2 組になり、
 *   古い組が残ると使用済みの更新トークンで次の取り直しが断られる（Supabase はそれを「盗まれた」とみなしてログインごと失効させる）
 * - 応答（既定）: 200 { ok: true, refreshed, expires_at } / 401 { ok: false, reason } / 503 { ok: false, reason: "retryable" }
 * - 応答（?format=gotrue）: supabase-js が Supabase の応答として読める形
 *   - 成功は 200 でセッション（トークン・期限・利用者）
 *   - 失敗は Supabase と同じ { error_code, msg }。断られた・ログインなしは 4xx。一時的な失敗は 503（supabase-js は Cookie を消さずに再試行する）
 *   - トークンはもともとブラウザの Cookie（JS から読める）にあるもので、返しても見える範囲は広がらない
 * - 別のサイトからの呼び出し（Origin が違う）は 403。Cookie も SameSite=Lax で別サイトの POST には付かない
 * - 失敗と取り直しの結果は console に 1 行出す（wrangler tail で見る。トークンは出さない）
 * - 経緯は src/lib/auth/session-refresh.ts
 */
export async function POST(request: Request): Promise<NextResponse> {
  const gotrue = new URL(request.url).searchParams.get("format") === "gotrue";
  if (!isSameOrigin(request)) return reply(gotrue, 403, "cross_origin");
  const supabase = await createClient();
  // getSession は Cookie を読むだけ（期限 90 秒前を切っていれば supabase-js がその場で取り直す）。
  // 利用者の確認は middleware の getUser が済ませている。ここで使うのは期限（expires_at）とトークン
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    if (error) return failed(gotrue, "getSession", error);
    const names = (await cookies()).getAll().map((c) => c.name);
    console.warn(`[auth/refresh] ログインなし（${describeAuthCookies(names)}）`);
    return reply(gotrue, 401, "no_session");
  }
  if (!needsRefresh(session.expires_at, Date.now())) {
    if (!gotrue) return ok({ ok: true, refreshed: false, expires_at: session.expires_at ?? null });
    // supabase-js が取り直しを頼んできたが、この要求の middleware などが取り直し済みだった → いまのセッションを返す。
    // 利用者の情報は getSession のものではなく getUser（Supabase に確かめたもの）を使う
    const { data: who, error: userError } = await supabase.auth.getUser();
    if (userError || !who.user) return failed(gotrue, "getUser", userError);
    return ok(toGoTrueSession(session, who.user));
  }
  const leftSec = typeof session.expires_at === "number" ? Math.round(session.expires_at - Date.now() / 1000) : null;
  const refreshed = await supabase.auth.refreshSession();
  const next = refreshed.data.session;
  if (refreshed.error || !next) return failed(gotrue, "refreshSession", refreshed.error);
  console.log(`[auth/refresh] 取り直した（残り ${leftSec ?? "?"} 秒の時点${gotrue ? "・supabase-js の依頼" : ""}）`);
  return ok(gotrue ? toGoTrueSession(next, next.user) : { ok: true, refreshed: true, expires_at: next.expires_at ?? null });
}

/** Supabase の POST /token の応答と同じ形（supabase-js は access_token・refresh_token・expires_in が揃っていればセッションとして保存する） */
function toGoTrueSession(session: Session, user: User) {
  const expiresAt = typeof session.expires_at === "number" ? session.expires_at : null;
  const expiresIn = session.expires_in || (expiresAt ? Math.max(1, Math.round(expiresAt - Date.now() / 1000)) : 3600);
  return {
    access_token: session.access_token,
    token_type: session.token_type ?? "bearer",
    expires_in: expiresIn,
    expires_at: expiresAt ?? undefined,
    refresh_token: session.refresh_token,
    user,
  };
}

type AuthErrorLike = { name?: string; status?: number; code?: string; message?: string } | null;

function failed(gotrue: boolean, step: string, error: AuthErrorLike): NextResponse {
  const status = typeof error?.status === "number" ? error.status : null;
  // 通信の失敗（status 0）と Supabase 側の 5xx は一時的。ログイン Cookie は supabase-js が残している
  const retryable = error?.name === "AuthRetryableFetchError" || status === 0 || (status !== null && status >= 500);
  console.warn(
    `[auth/refresh] ${step} 失敗: name=${error?.name ?? "-"} status=${status ?? "-"} code=${error?.code ?? "-"} message=${(error?.message ?? "").slice(0, 120)}`,
  );
  if (retryable) return reply(gotrue, 503, "retryable");
  const httpStatus = gotrue && status !== null && status >= 400 && status < 500 ? status : 401;
  return reply(gotrue, httpStatus, error?.code ?? "refresh_failed", error?.message);
}

function reply(gotrue: boolean, status: number, reason: string, message?: string): NextResponse {
  const body = gotrue ? { error_code: reason, msg: (message ?? reason).slice(0, 200) } : { ok: false, reason };
  return noStore(NextResponse.json(body, { status }));
}

function ok(body: object): NextResponse {
  return noStore(NextResponse.json(body));
}

/** 同じサイトからの呼び出しか（fetch の POST は Origin を付ける。付いていなければ Cookie の SameSite=Lax に任せる） */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
