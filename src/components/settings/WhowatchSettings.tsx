"use client";

import { useState, useEffect } from "react";
import { PlatformIdInput } from "./PlatformIdInput";

type ProfileData = {
  whowatchUserId: string | null;
  whowatchIsMonitoring: boolean;
};

export function WhowatchSettings() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [userId, setUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/platforms/whowatch/profile")
      .then((r) => (r.ok ? r.json() as Promise<ProfileData> : null))
      .then((data) => {
        if (data) {
          setProfile(data);
          setUserId(data.whowatchUserId ?? "");
        }
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/platforms/whowatch/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whowatchUserId: userId }),
      });
      if (res.ok) {
        const data = await res.json() as ProfileData;
        setProfile(data);
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "保存に失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleMonitoring() {
    setToggling(true);
    const action = profile?.whowatchIsMonitoring ? "stop" : "start";
    const res = await fetch("/api/platforms/whowatch/monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      const data = await res.json() as { isMonitoring: boolean };
      setProfile((prev) => prev ? { ...prev, whowatchIsMonitoring: data.isMonitoring } : prev);
    }
    setToggling(false);
  }

  const isConnected = Boolean(profile?.whowatchUserId);
  const isMonitoring = Boolean(profile?.whowatchIsMonitoring);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-foreground">ふわっち</div>
          <div className="mt-1 text-xs text-muted-foreground">
            配信IDから配信URL・視聴者数・ポイントを自動検出（5 秒ポーリング）
          </div>
        </div>
        <div className={`text-xs ${isConnected ? "text-status-success" : "text-muted-foreground"}`}>
          {isConnected ? "連携済み" : "未連携"}
        </div>
      </div>

      <div className="flex items-start gap-2">
        <div className="flex-1">
          <PlatformIdInput
            id="whowatchUserId"
            platform="whowatch"
            value={userId}
            onChange={setUserId}
            placeholder="ふわっち配信ID（例: @erupi2525）"
            helpText="ふわっちアプリ/サイトのプロフィールURLを貼り付けても自動でIDを抽出します（確認場所は要確認）"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !userId.trim()}
          className="min-h-11 shrink-0 rounded-full bg-secondary px-3 text-xs text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-40"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        配信中の場合、公開APIのライブ一覧から現在の配信URLを自動認識します
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {isConnected && (
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleToggleMonitoring}
            disabled={toggling}
            className={`min-h-11 rounded-full px-4 text-xs transition-colors disabled:opacity-40 ${
              isMonitoring
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "bg-status-success/10 text-status-success hover:bg-status-success/20"
            }`}
          >
            {toggling ? "…" : isMonitoring ? "モニタリング停止" : "モニタリング開始"}
          </button>
          {isMonitoring && (
            <span className="animate-pulse text-xs text-status-success">
              ● 監視中
            </span>
          )}
        </div>
      )}
    </div>
  );
}
