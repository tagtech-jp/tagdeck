"use server";

import { createClient } from "@/lib/supabase/server";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function resetPasswordAction(formData: FormData) {
  const result = resetPasswordSchema.safeParse({
    email: formData.get("email"),
  });

  if (!result.success) {
    const msg = encodeURIComponent(
      result.error.issues[0]?.message ?? "入力内容に誤りがあります"
    );
    redirect(`/reset-password?form_error=${msg}`);
  }

  const headersList = await headers();
  const origin = headersList.get("origin") ?? "http://localhost:3000";

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(
    result.data.email,
    {
      redirectTo: `${origin}/auth/confirm?next=/dashboard/settings`,
    }
  );

  if (error) {
    const msg = encodeURIComponent(`送信に失敗しました：${error.message}`);
    redirect(`/reset-password?form_error=${msg}`);
  }

  redirect("/reset-password?sent=true");
}
