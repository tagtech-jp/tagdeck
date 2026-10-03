import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * ログインしていなくても見られるページ（完全一致）。
 * 2026-10-03: /sitemap.xml・/terms（利用規約）・/privacy（プライバシーポリシー）がログイン画面へ転送されていた。
 * sitemap は検索エンジン向けで、そこに載せている規約と方針は、登録前の人が読めなければならない
 * （/robots.txt は public/ の静的ファイルなので Worker を通らないが、念のため並べる）
 */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set(["/", "/sitemap.xml", "/robots.txt", "/terms", "/privacy"]);

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() は必ず呼ぶ（Cookie のリフレッシュトリガー）
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/reset-password");
  const isAuthCallback = pathname.startsWith("/auth/");
  const isPublicRoute = PUBLIC_PATHS.has(pathname) || isAuthRoute || isAuthCallback;
  // API は画面ではないのでログイン画面へ転送しない（2026-10-03）。転送すると fetch がログイン画面の HTML を受け取り、
  // ライブ画面に「Unexpected token '<', "<!DOCTYPE"... is not valid JSON」が出ていた。
  // 各 API は自分でログインを確かめて 401（JSON）を返す（2026-10-03 に src/app/api 全 38 ルートを確認。/api/build だけは公開の識別子）
  const isApiRoute = pathname.startsWith("/api/");

  // 転送するときも、getUser() が書いた Cookie（取り直した新しいトークン・壊れたログインの削除）を必ず載せる（2026-10-03）。
  // 載せないと新しいトークンが捨てられ、ブラウザには使用済みの古い更新トークンが残る（次の取り直しで断られてログインが切れる）
  const redirectTo = (pathnameTo: string, withRedirectParam: boolean) => {
    const url = request.nextUrl.clone();
    url.pathname = pathnameTo;
    if (withRedirectParam) url.searchParams.set("redirect", pathname);
    const res = NextResponse.redirect(url);
    for (const cookie of supabaseResponse.cookies.getAll()) res.cookies.set(cookie);
    return res;
  };

  if (!user && !isPublicRoute && !isApiRoute) return redirectTo("/login", true);

  // ログイン済みでトップ（/）やログイン画面に来たらダッシュボードへ。
  // トップの判定は以前 src/middleware.ts で getSession() と「書き込まない Cookie」で行っていたが、期限間際だと
  // 取り直したトークンを捨ててしまうため、ここ（Cookie を書ける getUser の後）へ移した（2026-10-03）
  if (user && (isAuthRoute || pathname === "/")) return redirectTo("/dashboard", false);

  return supabaseResponse;
}
