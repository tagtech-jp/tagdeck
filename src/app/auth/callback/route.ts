import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

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
