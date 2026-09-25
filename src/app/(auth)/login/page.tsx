import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import Link from "next/link";
import { loginAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; form_error?: string }>;
}) {
  const params = await searchParams;
  const oauthErrorMap: Record<string, string> = {
    auth_callback_failed: "OAuth 認証に失敗しました",
    missing_code: "認証コードが見つかりません",
    confirm_failed: "メール確認に失敗しました",
    invalid_confirm_link: "確認リンクが無効です",
  };
  const errorMessage =
    params.form_error
      ? decodeURIComponent(params.form_error)
      : params.error
      ? oauthErrorMap[params.error]
      : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">ログイン</CardTitle>
        <CardDescription>
          TagDeck にログインして配信ダッシュボードにアクセスしましょう。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage && (
          <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        <OAuthButtons />

        <div className="relative">
          <Separator />
          <span className="absolute left-1/2 -top-2.5 -translate-x-1/2 bg-background px-2 text-xs text-muted-foreground">
            または
          </span>
        </div>

        <form action={loginAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">メールアドレス</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">パスワード</Label>
              <Link
                href="/reset-password"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                パスワードを忘れた
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" className="w-full">
            ログイン
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          アカウントをお持ちでない方は{" "}
          <Link href="/signup" className="text-primary hover:underline">
            新規登録
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
