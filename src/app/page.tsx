import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Footer } from "@/components/layout/Footer";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
        {/* Aurora beam: iris (60%) → ember → white, narrow vertical streak (DESIGN.md Gradient System) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-1/2 w-[20%] -translate-x-1/2 opacity-70 blur-3xl"
          style={{
            background:
              "linear-gradient(180deg, rgba(86,131,218,0.6) 0%, #ff8964 55%, #ffffff 100%)",
          }}
        />
        {/* Radial sunburst at the base: #ffaa81 → #ffda9f → transparent, 400px, 40% */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-[200px] left-1/2 size-[400px] -translate-x-1/2 rounded-full opacity-40 blur-2xl"
          style={{
            background: "radial-gradient(circle, #ffaa81 0%, #ffda9f 45%, transparent 70%)",
          }}
        />
        <h1 className="relative mb-4 text-display-sm leading-display-sm tracking-display-sm font-semibold md:text-display md:leading-display md:tracking-display">
          データで勝つ。
        </h1>
        <p className="relative mb-6 text-subheading leading-subheading tracking-subheading text-muted-foreground">
          配信イベント戦略支援ツール
        </p>
        <span className="mb-10 inline-block rounded-full bg-status-warning px-4 py-1.5 text-sm font-semibold text-void">
          🚀 Beta - 全機能無料公開中
        </span>
        {user ? (
          <Link
            href="/dashboard"
            className="relative rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            ダッシュボードへ
          </Link>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Link
              href="/signup"
              className="relative rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              無料で始める
            </Link>
            <p className="text-sm text-muted-foreground">
              既にアカウントをお持ちの方は{" "}
              <Link href="/login" className="text-primary hover:underline">
                ログイン
              </Link>
            </p>
          </div>
        )}
      </section>

      {/* Features */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-2 text-lg font-bold text-foreground">順位予測</h3>
            <p className="text-sm text-muted-foreground">
              モンテカルロシミュレーションで順位達成確率を可視化
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-2 text-lg font-bold text-foreground">リスナー管理</h3>
            <p className="text-sm text-muted-foreground">
              応援履歴・タグ・メモで配信者ごとの最適アプローチ
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-2 text-lg font-bold text-foreground">マルチプラットフォーム監視</h3>
            <p className="text-sm text-muted-foreground">
              ふわっち・ニコ生・Kick・YouTube Live をリアルタイム監視
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <h3 className="mb-2 text-lg font-bold text-foreground">ペース可視化</h3>
            <p className="text-sm text-muted-foreground">
              経験ベイズによる事後推定で目標達成までのペース判定
            </p>
          </div>
        </div>
      </section>

      {/* Screenshots */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="mb-10 text-center text-2xl font-bold text-foreground">機能プレビュー</h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* ベータ公開後に実画像へ差し替え */}
          <svg
            viewBox="0 0 1280 720"
            className="w-full rounded-xl border border-border"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="1280" height="720" className="fill-card" />
            <text
              x="640"
              y="360"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-iron-veil"
              fontSize="56"
              fontFamily="sans-serif"
            >
              ダッシュボード
            </text>
          </svg>
          {/* ベータ公開後に実画像へ差し替え */}
          <svg
            viewBox="0 0 1280 720"
            className="w-full rounded-xl border border-border"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="1280" height="720" className="fill-card" />
            <text
              x="640"
              y="360"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-iron-veil"
              fontSize="56"
              fontFamily="sans-serif"
            >
              イベント詳細
            </text>
          </svg>
          {/* ベータ公開後に実画像へ差し替え */}
          <svg
            viewBox="0 0 1280 720"
            className="w-full rounded-xl border border-border"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect width="1280" height="720" className="fill-card" />
            <text
              x="640"
              y="360"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-iron-veil"
              fontSize="56"
              fontFamily="sans-serif"
            >
              リスナー一覧
            </text>
          </svg>
        </div>
      </section>

      {/* Platforms */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="mb-10 text-center text-2xl font-bold text-foreground">対応プラットフォーム</h2>
        <div className="flex flex-col gap-8">
          <div>
            <span className="mb-4 inline-block rounded-full border border-status-success/30 bg-status-success/20 px-2.5 py-1 text-xs font-semibold text-status-success">
              Phase 3a · 対応中
            </span>
            <ul className="flex flex-wrap gap-3">
              {["ふわっち", "ニコニコ生放送", "Kick", "YouTube Live", "Twitch"].map((pf) => (
                <li
                  key={pf}
                  className="rounded-full border border-border bg-card px-5 py-2.5 text-sm text-foreground"
                >
                  {pf}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <span className="mb-4 inline-block rounded-full border border-primary/30 bg-primary/20 px-2.5 py-1 text-xs font-semibold text-primary">
              Phase 3b · 次期対応
            </span>
            <ul className="flex flex-wrap gap-3">
              {["TikTok Live", "ツイキャス"].map((pf) => (
                <li
                  key={pf}
                  className="rounded-full border border-border bg-card px-5 py-2.5 text-sm text-muted-foreground"
                >
                  {pf}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <span className="mb-4 inline-block rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
              Phase 3c+ · 対応予定
            </span>
            <ul className="flex flex-wrap gap-3">
              {["Pococha", "REALITY", "BIGO LIVE", "ミクチャ", "17LIVE", "その他"].map((pf) => (
                <li
                  key={pf}
                  className="rounded-full border border-border bg-card px-5 py-2.5 text-sm text-muted-foreground"
                >
                  {pf}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
