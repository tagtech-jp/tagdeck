import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/safe-next";
import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // 戻り先はサイト内のパスだけ（別サイトへ飛ばせるオープンリダイレクトを閉じる・2026-10-08。判定は src/lib/auth/safe-next.ts）
  const next = safeNextPath(searchParams.get("next"));

  if (!token_hash || !type) {
    return NextResponse.redirect(
      `${origin}/login?error=invalid_confirm_link`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash,
  });

  if (error) {
    console.error("Email confirm error:", error);
    return NextResponse.redirect(`${origin}/login?error=confirm_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
