import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h3 className="mb-2 text-sm font-semibold text-foreground">配信プラットフォーム</h3>
          <p className="mb-1 text-xs text-muted-foreground">
            ベータ期間中のフィードバックは配信コメントでお願いします
          </p>
          <p className="mb-4 text-xs text-muted-foreground">TikTok 等への展開も予定</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href="https://whowatch.tv/profile/t:kuroppi1022"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              ふわっち
            </a>
            <a
              href="https://www.nicovideo.jp/user/371385"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              ニコニコ生放送
            </a>
            <a
              href="https://kick.com/erupi1022"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              Kick
            </a>
            <a
              href="https://youtube.com/@tagtech_jp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline"
            >
              YouTube Live
            </a>
          </div>
        </div>

        <hr className="mb-6 border-border" />

        <div className="mb-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground">
            利用規約
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            プライバシーポリシー
          </Link>
          <a
            href="https://tagtech.jp"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground"
          >
            運営: TagTech
          </a>
        </div>

        <p className="text-xs text-muted-foreground">© 2026 TagTech</p>
      </div>
    </footer>
  );
}
