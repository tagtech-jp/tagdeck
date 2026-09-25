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
import Link from "next/link";
import { resetPasswordAction } from "./actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; form_error?: string }>;
}) {
  const params = await searchParams;

  if (params.sent === "true") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">メールを送信しました</CardTitle>
          <CardDescription>
            ご登録のメールアドレスにパスワードリセット用のリンクを送信しました。
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
        <CardTitle className="text-2xl">パスワードリセット</CardTitle>
        <CardDescription>
          ご登録のメールアドレスにリセット用のリンクを送信します。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {errorMessage && (
          <p className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </p>
        )}
        <form action={resetPasswordAction} className="space-y-4">
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
          <Button type="submit" className="w-full">
            リセットリンクを送信
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            ログイン画面に戻る
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
