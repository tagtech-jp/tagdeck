import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // ログインの取り直しはサーバ（/api/auth/refresh と middleware）だけが行う（2026-10-03）。
      // ブラウザで取り直しが失敗すると supabase-js がログイン Cookie を消してしまう。理由と経緯は src/lib/auth/session-refresh.ts
      auth: { autoRefreshToken: false },
    }
  );
}
