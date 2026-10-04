import { createBrowserClient } from "@supabase/ssr";
import { SESSION_REFRESH_PATH } from "@/lib/auth/session-refresh";

// ログインの取り直しはサーバ（/api/auth/refresh と middleware）だけが行う（2026-10-03）。
// ブラウザの supabase-js が Supabase に直接取り直しを頼み、それが失敗すると、supabase-js はその場でログイン Cookie を消してしまう。
// 本番では「ログインから約 51 分後に切れる」が 3 回続けて起きた。理由と経緯は src/lib/auth/session-refresh.ts

/** 純関数: supabase-js が送ろうとしている要求が「ログインの取り直し」（POST /auth/v1/token?grant_type=refresh_token）か */
export function isRefreshTokenRequest(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.endsWith("/auth/v1/token") && u.searchParams.get("grant_type") === "refresh_token";
  } catch {
    return false;
  }
}

/**
 * ブラウザの supabase-js に渡す fetch。ログインの取り直しだけは Supabase へ送らず、自分のサーバの窓口に回す
 * （窓口は Supabase と同じ形で応答するので、supabase-js はそのまま保存する。それ以外の要求は素通し）
 */
export const fetchWithServerRefresh: typeof fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (isRefreshTokenRequest(url)) {
    return fetch(`${SESSION_REFRESH_PATH}?format=gotrue`, { method: "POST", credentials: "same-origin", cache: "no-store" });
  }
  return fetch(input, init);
};

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: fetchWithServerRefresh },
      // 期限前の取り直しは SessionKeeper がサーバに頼む。supabase-js 自身の定期の取り直しは使わない
      auth: { autoRefreshToken: false },
    }
  );
}
