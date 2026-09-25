import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { BetaBanner } from "@/components/layout/BetaBanner";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://tagdeck.jp"),
  title: {
    default: "TagDeck - 配信イベント戦略支援ツール",
    template: "%s | TagDeck",
  },
  description:
    "配信イベントの順位予測・リスナー管理を支援する配信者向けツール。ふわっち・ニコニコ生放送・Kick・YouTube Live に対応、TikTok 等への展開も予定。モンテカルロシミュレーションで順位達成確率を可視化。Beta 期間中は全機能無料。",
  keywords: [
    "配信 イベント 順位予測",
    "ライブ配信 イベント 戦略",
    "配信者 イベント 勝率",
    "ふわっち イベント",
    "TikTok ライブ イベント",
    "ニコ生 イベント 順位",
    "モンテカルロ 順位 予測",
    "配信者 リスナー管理",
  ],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TagDeck",
  },
  openGraph: {
    title: "TagDeck - 配信イベント戦略支援ツール",
    description:
      "配信イベントの順位予測・リスナー管理を支援する配信者向けツール。ふわっち・ニコニコ生放送・Kick・YouTube Live に対応、TikTok 等への展開も予定。モンテカルロシミュレーションで順位達成確率を可視化。Beta 期間中は全機能無料。",
    url: "https://tagdeck.jp",
    siteName: "TagDeck",
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TagDeck - 配信イベント戦略支援ツール",
    description:
      "配信イベントの順位予測・リスナー管理を支援する配信者向けツール。ふわっち・ニコニコ生放送・Kick・YouTube Live に対応、TikTok 等への展開も予定。モンテカルロシミュレーションで順位達成確率を可視化。Beta 期間中は全機能無料。",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: "https://tagdeck.jp",
  },
};

export const viewport: Viewport = {
  themeColor: "#090a0c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "TagTech",
      url: "https://tagtech.jp",
    },
    {
      "@type": "WebSite",
      name: "TagDeck",
      url: "https://tagdeck.jp",
      description: "配信イベント戦略支援ツール - ふわっち・ニコ生・Kick・YouTube Live 対応",
      publisher: {
        "@type": "Organization",
        name: "TagTech",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className="dark" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${inter.className} bg-background text-foreground`}>
        <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" enableSystem={false} disableTransitionOnChange>
          <BetaBanner />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
