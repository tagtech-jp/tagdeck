import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

/** Authorization ヘッダーから Bearer トークンを取り出す。無ければ null（純関数・テスト用に export） */
export function bearerTokenOf(authorization: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec((authorization ?? "").trim());
  return m ? m[1] : null;
}

/**
 * Bearer（Supabase のアクセストークン）でログインを渡す呼び出し元（スマホアプリ・Capacitor）向けのクライアント（2026-10-07・スマホアプリ化 第 1 段階）。
 * Cookie は見ない。本人確認は auth.getUser(token)、DB（PostgREST）の RLS はグローバルの Authorization ヘッダーで本人として動く。
 * 各 API ルートは supabase.auth.getUser() を引数なしで呼んでいる（38 ルート）ので、引数なしの呼び出しをトークン付きに読み替える
 */
export function createBearerClient(token: string) {
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // Bearer の呼び出し元に Cookie は返さない
      },
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const original = client.auth.getUser.bind(client.auth);
  client.auth.getUser = (jwt?: string) => original(jwt ?? token);
  return client;
}

export async function createClient() {
  // Bearer があれば Cookie 経路を使わない（アプリ）。無ければこれまでどおり Cookie（ブラウザ）
  const token = bearerTokenOf((await headers()).get("authorization"));
  if (token) return createBearerClient(token);

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component から呼ばれた場合は無視
          }
        },
      },
    }
  );
}
