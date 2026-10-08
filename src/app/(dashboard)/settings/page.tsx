import { createClient } from "@/lib/supabase/server";
import { SettingsPlatformSummary } from "@/components/settings/SettingsPlatformSummary";
import { DeleteAccountSection } from "@/components/settings/DeleteAccountSection";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="space-y-4">
      {/* R9 迷1/迷2対策: 設定を開いてすぐ連携状況が分かるよう最上段に配置 */}
      <SettingsPlatformSummary />

      <h3 className="text-lg font-bold text-foreground">プロファイル</h3>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div>
          <div className="text-xs text-muted-foreground">メールアドレス</div>
          <div className="text-sm text-foreground">{user?.email}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">表示名</div>
          <div className="text-sm text-foreground">
            {user?.user_metadata?.display_name ?? "未設定"}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        プロファイル編集はフェーズ 4 で実装予定
      </p>

      {/* 退会（2026-10-08・セキュリティ監査 §3-7）。プライバシーポリシー第 4 項の「設定 → プロファイル → アカウントの削除」がここ */}
      <DeleteAccountSection />
    </div>
  );
}
