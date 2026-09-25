"use server";

import { createClient } from "@/lib/supabase/server";
import { signupSchema } from "@/lib/validations/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

export async function signupAction(formData: FormData) {
  const result = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
    displayName: formData.get("displayName"),
  });

  if (!result.success) {
    const msg = encodeURIComponent(
      result.error.issues[0]?.message ?? "入力内容に誤りがあります"
    );
    redirect(`/signup?form_error=${msg}`);
  }

  const headersList = await headers();
  const origin = headersList.get("origin") ?? "http://localhost:3000";

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: result.data.email,
    password: result.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/confirm`,
      data: {
        display_name: result.data.displayName,
      },
    },
  });

  if (error) {
    const msg = encodeURIComponent(`登録に失敗しました：${error.message}`);
    redirect(`/signup?form_error=${msg}`);
  }

  redirect("/signup?success=true");
}
