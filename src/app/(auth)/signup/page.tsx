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
import { signupAction } from "./actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; form_error?: string }>;
}) {
  const params = await searchParams;

  if (params.success === "true") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">確認メールを送信しました</CardTitle>
          <CardDescription>
            ご登録のメールアドレスに確認リンクを送信しました。リンクをクリックして登録を完了してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/login"
            className="text-sm text-primary hover:underline"
          >
            ログイン画面に戻る
          </Link>
        </CardContent>
      </Card>
    );
  }

  const errorMessage = params.form_error
    ? decodeURIComponent(params.form_error)
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">新規登録</CardTitle>
        <CardDescription>TagDeck アカウントを作成しましょう。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-status-warning px-3 py-2 text-center text-sm font-semibold text-void">
          🚀 Beta 期間中・全機能無料 / フィードバックは配信コメントでお願いします
        </div>
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

        <form action={signupAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">表示名</Label>
            <Input
              id="displayName"
              name="displayName"
              type="text"
              required
              maxLength={50}
              placeholder="ニックネーム"
            />
          </div>
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
            <Label htmlFor="password">パスワード</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
            />
            <p className="text-xs text-muted-foreground">
              8 文字以上、大文字・小文字・数字を含む
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="passwordConfirm">パスワード（確認）</Label>
            <Input
              id="passwordConfirm"
              name="passwordConfirm"
              type="password"
              required
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" className="w-full">
            登録
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          既にアカウントをお持ちの方は{" "}
          <Link href="/login" className="text-primary hover:underline">
            ログイン
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
