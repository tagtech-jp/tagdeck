import { WhowatchSettings } from "@/components/settings/WhowatchSettings";
import { KickSettings } from "@/components/settings/KickSettings";
import { NiconicoSettings } from "@/components/settings/NiconicoSettings";

export default function PlatformSettingsPage() {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-foreground">プラットフォーム連携</h3>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4">
          <div className="font-medium text-foreground">ふわっち</div>
          <div className="mt-1 text-xs text-muted-foreground">
            5 秒ポーリングで視聴者数・累計ポイントを取得
          </div>
        </div>
        <WhowatchSettings />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4">
          <div className="font-medium text-foreground">Kick</div>
          <div className="mt-1 text-xs text-muted-foreground">
            公式 Pusher WebSocket でチャット・ギフトをリアルタイム取得
          </div>
        </div>
        <KickSettings />
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4">
          <div className="font-medium text-foreground">ニコ生</div>
          <div className="mt-1 text-xs text-muted-foreground">
            5 秒ポーリングで視聴者数・コメント数をリアルタイム取得
          </div>
        </div>
        <NiconicoSettings />
      </div>
    </div>
  );
}
