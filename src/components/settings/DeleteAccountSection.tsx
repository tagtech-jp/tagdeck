"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CONFIRM_WORD } from "@/lib/account/delete-account";

/**
 * 設定 → プロファイルの末尾「アカウントの削除」（退会・2026-10-08・セキュリティ監査 §3-7）。
 * 押すと確認欄が開き、「削除」と入力したときだけ実行できる。成功したらトップへ戻す（ログイン Cookie は API 側で消えている）。
 * 実体は POST /api/account/delete（src/app/api/account/delete/route.ts）
 */
export function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim() === CONFIRM_WORD;

  async function handleDelete() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: typed.trim() }),
      });
      if (res.ok) {
        // 退会済み。履歴に戻れないよう replace でトップへ
        window.location.replace("/");
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? `削除に失敗しました（HTTP ${res.status}）`);
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setOpen(false);
    setTyped("");
    setError(null);
  }

  return (
    <section className="space-y-3 rounded-lg border border-destructive/40 bg-card p-4">
      <h3 className="text-lg font-bold text-foreground">アカウントの削除</h3>
      <p className="text-sm text-muted-foreground">
        アカウントと、TagDeck に保存されたあなたのデータをすべて削除します。削除は取り消せません。
      </p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>登録情報（メールアドレス・表示名・外部サービスでのログイン）</li>
        <li>配信プラットフォームの連携と配信の状態</li>
        <li>視聴者（リスナー）の記録（ギフト・コメント・ニックネーム・メモ）</li>
        <li>イベント勝率シミュレーターと過去イベントの記録</li>
        <li>SE の設定とアップロードした音源</li>
      </ul>
      <p className="text-xs text-muted-foreground">
        詳しくは{" "}
        <Link href="/privacy" className="text-primary hover:underline">
          プライバシーポリシー
        </Link>{" "}
        をご覧ください。
      </p>
      {!open ? (
        <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
          アカウントを削除する
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg bg-muted p-3">
          <label htmlFor="delete-account-confirm" className="block text-sm text-foreground">
            確認のため「{CONFIRM_WORD}」と入力してください
          </label>
          <Input
            id="delete-account-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={CONFIRM_WORD}
            autoComplete="off"
            disabled={busy}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="destructive" disabled={!ready || busy} onClick={handleDelete}>
              {busy ? "削除しています…" : "削除を実行する"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={cancel}>
              やめる
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
