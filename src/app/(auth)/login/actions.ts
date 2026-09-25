"use server";

import { createClient } from "@/lib/supabase/server";
import { loginSchema } from "@/lib/validations/auth";
import { redirect } from "next/navigation";

export async function loginAction(formData: FormData) {
  const result = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.success) {
    const msg = encodeURIComponent(
      result.error.issues[0]?.message ?? "入力内容に誤りがあります"
    );
    redirect(`/login?form_error=${msg}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(result.data);

  if (error) {
    const msg = encodeURIComponent(
      error.message === "Invalid login credentials"
        ? "メールアドレスまたはパスワードが正しくありません"
        : `ログインに失敗しました：${error.message}`
    );
    redirect(`/login?form_error=${msg}`);
  }

  redirect("/dashboard");
}
