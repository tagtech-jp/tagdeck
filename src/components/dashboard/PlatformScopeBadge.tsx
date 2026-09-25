// プラットフォーム限定機能の注釈バッジ（R9: 「CRM（Kickのみ）」方式を全メニュー/タブ/カードに体系適用）。

export type ScopedPlatform = "whowatch" | "kick" | "niconico";

const LABELS: Record<ScopedPlatform, string> = {
  whowatch: "ふわっち",
  kick: "Kick",
  niconico: "ニコ生",
};

export function PlatformScopeBadge({ platforms }: { platforms: ScopedPlatform[] }) {
  const text = platforms.map((p) => LABELS[p]).join("・");
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
      {text}のみ
    </span>
  );
}
