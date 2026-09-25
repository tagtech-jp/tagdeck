import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "利用規約 | TagDeck",
  description: "TagDeck の利用規約。TagTech 共通利用規約に従います。",
};

export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-background px-6 py-12 text-foreground">
      <h1 className="mb-6 text-3xl font-bold">利用規約</h1>
      <div className="space-y-4 leading-relaxed text-muted-foreground">
        <p>
          TagDeck は TagTech が提供するサービスの一つです。TagDeck のご利用にあたっては、
          TagTech 共通利用規約が適用されます。
        </p>
        <p>
          現在 TagDeck はベータ版として提供されています。ベータ期間中はサービスの仕様変更・
          データの消失・予告なき停止が発生する可能性があります。これらによって生じた損害について、
          当方は責任を負いかねます。
        </p>
        <p>
          TagDeck をご利用いただいた時点で、TagTech 共通利用規約およびベータ版に関する上記事項に
          同意したものとみなします。
        </p>
        <p>
          TagTech 共通利用規約の全文はこちらをご確認ください：
        </p>
        <a
          href="https://tagtech.jp/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-primary hover:underline"
        >
          TagTech 共通利用規約はこちら →
        </a>
      </div>
    </main>
  );
}
