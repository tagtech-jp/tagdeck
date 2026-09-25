import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "プライバシーポリシー | TagDeck",
  description: "TagDeck のプライバシーポリシー。TagTech 共通プライバシーポリシーに従います。",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-background px-6 py-12 text-foreground">
      <h1 className="mb-6 text-3xl font-bold">プライバシーポリシー</h1>
      <div className="space-y-4 leading-relaxed text-muted-foreground">
        <p>
          TagDeck における個人情報の取り扱いは、TagTech 共通プライバシーポリシーに従います。
          メールアドレス・表示名等の登録情報は Supabase のデータベースに保存され、
          認証目的にのみ使用されます。
        </p>
        <p>
          TagDeck のベータ期間中、サービスの改善を目的として利用ログ（操作履歴・エラー情報等）を
          収集する場合があります。これらの情報は第三者に提供されません。
        </p>
        <p>
          TagTech 共通プライバシーポリシーの全文はこちらをご確認ください：
        </p>
        <a
          href="https://tagtech.jp/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-primary hover:underline"
        >
          TagTech 共通プライバシーポリシーはこちら →
        </a>
      </div>
    </main>
  );
}
