import type { Metadata } from "next";
import Link from "next/link";

// 2026-10-08 セキュリティ監査 §3-5 で「記載と実態の差」を指摘され、実際に保存している情報（視聴者の記録を含む）・利用目的・
// 委託先・保管と削除・視聴者向けの案内を書いた版に改めた。文面は社長決裁（PR の本文に経緯）。構成は tagtech.jp/privacy に合わせている。
// 実態が変わる変更（保存する項目・委託先の追加）をしたら、本ページと docs/ops/account_deletion_20261008.md を同じ PR で直すこと。

export const metadata: Metadata = {
  title: "プライバシーポリシー | TagDeck",
  description: "TagDeck のプライバシーポリシー — 取得する情報（視聴者の記録を含む）・利用目的・委託先・保管と削除について",
};

const CONTACT_URL = "https://tagtech.jp/contact";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
      {children}
    </a>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-background px-6 py-12 text-foreground">
      <h1 className="mb-2 text-3xl font-bold">プライバシーポリシー</h1>
      <p className="mb-8 text-sm text-muted-foreground">最終更新日：2026年10月8日</p>

      <div className="space-y-8 leading-relaxed text-muted-foreground">
        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">事業者</h2>
          <p>TagTech（個人事業）</p>
          <p>
            お問い合わせ：<ExternalLink href={CONTACT_URL}>{CONTACT_URL}</ExternalLink>
          </p>
          <p>
            TagDeck は TagTech が提供する配信者向けの管理ツールです。本ポリシーは TagDeck（tagdeck.jp とスマホアプリ版）で取得する情報について定めます。
            tagtech.jp 本体（お問い合わせフォーム等）については{" "}
            <ExternalLink href="https://tagtech.jp/privacy">TagTech のプライバシーポリシー</ExternalLink> をご覧ください。
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">1. 取得する情報</h2>

          <h3 className="font-semibold text-foreground">(1) 登録情報</h3>
          <ul className="list-disc space-y-1 pl-6">
            <li>メールアドレス、表示名、パスワード（パスワードは復元できない形に変換して保存します）</li>
            <li>外部サービス（Google / X / Discord）でログインする場合は、そのサービスが提供する利用者の識別子と、メールアドレス・表示名</li>
            <li>ログイン状態を保つための Cookie（認証トークン）</li>
          </ul>

          <h3 className="font-semibold text-foreground">(2) 連携した配信プラットフォームの情報（配信者ご自身の情報）</h3>
          <ul className="list-disc space-y-1 pl-6">
            <li>ご自身のふわっちのユーザー ID、Kick のユーザー名、ニコニコ生放送のユーザー ID</li>
            <li>配信の状態（配信中かどうか、配信 ID・番組 ID、視聴者数、コメント数、獲得ポイント、フォロワー数、番組タイトル）</li>
          </ul>
          <p>これらは、ご自身が登録した ID を使って、各プラットフォームの公開 API・公開ページから取得します。</p>

          <h3 className="font-semibold text-foreground">(3) 配信中に取得する視聴者（リスナー）の情報</h3>
          <p>
            配信者が配信の監視を開始している間、次の情報を各プラットフォームの公開 API から取得し、その配信者の管理画面でだけ使う記録として保存します。
          </p>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              ふわっち：ギフト（アイテム）を贈った視聴者のユーザー ID と表示名（匿名で贈られたものは視聴者の情報を保存しません）、アイテムの種類・個数・定価、
              贈られた日時、ギフトに添えられたコメント本文（公開 API の応答をそのまま保存します）
            </li>
            <li>Kick：チャットのコメント本文と送信者のユーザー ID・ユーザー名、ギフトサブスクリプションの送り主・対象・日時</li>
            <li>ニコニコ生放送：視聴者個人の情報は保存しません（視聴者数・コメント数の合計のみ）</li>
            <li>配信者が視聴者ごとに付けるニックネーム・メモ、ギフトとコメントの累計</li>
          </ul>
          <p>ふわっちのギフト以外のコメントは、配信中の画面に表示するだけで保存しません。</p>

          <h3 className="font-semibold text-foreground">(4) イベント勝率シミュレーターの情報</h3>
          <ul className="list-disc space-y-1 pl-6">
            <li>参加するイベントの名前・目標、ご自身の得点と順位の推移</li>
            <li>公開ランキングに掲載されている他の配信者の名前・順位・得点（公開 API から取得したランキングの記録）</li>
          </ul>

          <h3 className="font-semibold text-foreground">(5) SE（効果音）の設定と音源</h3>
          <ul className="list-disc space-y-1 pl-6">
            <li>アイテムごとの効果音の割り当てと音量</li>
            <li>
              アップロードした音声ファイル。URL を知っている人なら誰でも再生できる公開設定で保管します。個人を特定できる内容や、権利を持たない音源を含めないでください
            </li>
          </ul>

          <h3 className="font-semibold text-foreground">(6) 通信の記録</h3>
          <ul className="list-disc space-y-1 pl-6">
            <li>
              サービスの配信とセキュリティ保護のため、Cloudflare のネットワーク上で IP アドレス・ブラウザの種類などの通信情報が処理されます
            </li>
            <li>障害対応のため、エラー情報と操作の記録（日時・操作の種類）をサーバーのログに残します</li>
            <li>アクセス解析や広告のための Cookie・外部タグは使用していません</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">2. 利用目的</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>ログインと本人確認、アカウントの管理</li>
            <li>配信イベントの戦略支援（勝率の推定、目標の逆算、順位の通知）</li>
            <li>配信中の演出（ギフトに応じた効果音の再生）</li>
            <li>配信の振り返りとリスナー管理（ギフト・コメントの累計、ニックネーム・メモ）</li>
            <li>不正利用の防止、障害対応、サービスの改善</li>
          </ul>
          <p>取得した情報を、これら以外の目的（広告配信、第三者への販売など）に使うことはありません。</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">3. 第三者提供・委託</h2>
          <p>法令に基づく場合を除き、取得した情報を第三者に提供・販売しません。</p>
          <p>次の事業者に取扱いを委託しています。委託先では、各社のプライバシーポリシーに基づいて情報が処理されます。</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>Supabase, Inc.：データベース、ログイン認証、音声ファイルの保管</li>
            <li>Cloudflare, Inc.：アプリケーションの実行と配信、通信の保護</li>
            <li>Google LLC（Google Play）：スマホアプリ版を提供する場合の、アプリの配布と課金</li>
          </ul>
          <p>外部サービスでログインする場合、認証は各サービス（Google / X / Discord）の規約とプライバシーポリシーに従います。</p>
          <p>
            配信プラットフォーム（ふわっち・Kick・ニコニコ生放送）から情報を取得するために、ご自身が登録した ID・配信 ID を各プラットフォームの公開 API に送信します。
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">4. 保管と削除</h2>
          <ul className="list-disc space-y-1 pl-6">
            <li>取得した情報は、アカウントがある間、委託先のデータベースと保管領域に保管します</li>
            <li>
              退会（アカウントの削除）は、ログイン後の「
              <Link href="/settings" className="text-primary hover:underline">
                設定 → プロファイル → アカウントの削除
              </Link>
              」からいつでも行えます。登録情報、連携したプラットフォームの情報、視聴者の記録、シミュレーターの記録、SE の設定と音源がすべて削除され、削除後は復元できません
            </li>
            <li>削除した情報は、バックアップからも一定期間が経過した後に消去されます</li>
            <li>アカウントを削除せずに特定の記録だけを削除したい場合や、開示・訂正をご希望の場合は、お問い合わせフォームからご連絡ください</li>
            <li>個人を含まない共有データ（アイテムの価格表、イベントの一覧など）は、アカウントの削除の対象ではありません</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">5. 視聴者（リスナー）の方へ</h2>
          <p>
            配信者が TagDeck で監視している配信でギフトやコメントをすると、第 1 項 (3) の情報がその配信者の管理画面に記録されます。
            記録はその配信者と当方だけが見ることができ、ほかの利用者には公開しません。
          </p>
          <p>
            ご自身の記録の削除をご希望の場合は、プラットフォーム名・配信者名・ご自身のユーザー ID（または表示名）を添えて、
            <ExternalLink href={CONTACT_URL}>お問い合わせフォーム</ExternalLink>からご連絡ください。確認のうえ速やかに削除します。
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">6. 改定</h2>
          <p>本ポリシーを改定した場合は、本ページで公表し、最終更新日を更新します。</p>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">お問い合わせ</h2>
          <p>
            <ExternalLink href={CONTACT_URL}>{CONTACT_URL}</ExternalLink>
          </p>
        </section>
      </div>
    </main>
  );
}
