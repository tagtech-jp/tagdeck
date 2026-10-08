import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/safe-next";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // 戻り先はサイト内のパスだけ（別サイトへ飛ばせるオープンリダイレクトを閉じる・2026-10-08。判定は src/lib/auth/safe-next.ts）
  const next = safeNextPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Auth callback error:", {
      message: error.message,
      code: (error as any).code,
      status: (error as any).status,
      details: JSON.stringify(error),
    });
    return NextResponse.redirect(
      `${origin}/login?error=auth_callback_failed`
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
