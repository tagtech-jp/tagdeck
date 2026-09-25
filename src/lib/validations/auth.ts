import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください"),
  password: z.string().min(8, "パスワードは 8 文字以上で入力してください"),
});

export const signupSchema = z
  .object({
    email: z.string().email("有効なメールアドレスを入力してください"),
    password: z
      .string()
      .min(8, "パスワードは 8 文字以上で入力してください")
      .regex(/[A-Z]/, "大文字を 1 文字以上含めてください")
      .regex(/[a-z]/, "小文字を 1 文字以上含めてください")
      .regex(/[0-9]/, "数字を 1 文字以上含めてください"),
    passwordConfirm: z.string(),
    displayName: z
      .string()
      .min(1, "表示名を入力してください")
      .max(50, "表示名は 50 文字以内で入力してください"),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "パスワードが一致しません",
    path: ["passwordConfirm"],
  });

export const resetPasswordSchema = z.object({
  email: z.string().email("有効なメールアドレスを入力してください"),
});

export const updatePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "パスワードは 8 文字以上で入力してください")
      .regex(/[A-Z]/, "大文字を 1 文字以上含めてください")
      .regex(/[a-z]/, "小文字を 1 文字以上含めてください")
      .regex(/[0-9]/, "数字を 1 文字以上含めてください"),
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "パスワードが一致しません",
    path: ["passwordConfirm"],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
