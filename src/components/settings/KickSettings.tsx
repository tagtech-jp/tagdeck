"use client";

import { useState, useEffect } from "react";
import { PlatformIdInput } from "./PlatformIdInput";

export function KickSettings() {
  const [username, setUsername] = useState("");
  const [channelInfo, setChannelInfo] = useState<{
    username: string;
    followerCount: number;
    isLive: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/platforms/kick/profile")
      .then((res) => res.json())
      .then((data) => {
        if (data.kickUsername) {
          setUsername(data.kickUsername);
          setChannelInfo({
            username: data.kickUsername,
            followerCount: data.kickFollowerCount ?? 0,
            isLive: data.kickIsLive ?? false,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/platforms/kick/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage({ type: "success", text: "Kick username を保存しました" });
        setChannelInfo(data.channelInfo);
      } else {
        setMessage({ type: "error", text: data.error ?? "保存に失敗しました" });
      }
    } catch {
      setMessage({ type: "error", text: "通信エラーが発生しました" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">読み込み中...</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <PlatformIdInput
        id="kickUsername"
        label="Kick username"
        platform="kick"
        value={username}
        onChange={setUsername}
        placeholder="例：xqc"
        helpText="Kick の URL の最後の部分（例：kick.com/xqc）。プロフィールURLを貼り付けても自動抽出します"
      />
      <button
        type="submit"
        disabled={saving || !username.trim()}
        className="min-h-11 rounded-full bg-secondary px-4 text-sm text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "保存中..." : "保存"}
      </button>
      {message && (
        <p
          className={`text-sm ${
            message.type === "success"
              ? "text-status-success"
              : "text-destructive"
          }`}
        >
          {message.text}
        </p>
      )}
      {channelInfo && (
        <div className="space-y-1 rounded-lg bg-muted p-3 text-xs">
          <div>
            <span className="text-muted-foreground">登録済み: </span>
            <span className="font-mono text-foreground">{channelInfo.username}</span>
          </div>
          <div>
            <span className="text-muted-foreground">フォロワー数: </span>
            <span className="text-foreground">{channelInfo.followerCount.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-muted-foreground">配信状態: </span>
            <span className={channelInfo.isLive ? "text-status-success" : "text-muted-foreground"}>
              {channelInfo.isLive ? "配信中" : "オフライン"}
            </span>
          </div>
        </div>
      )}
    </form>
  );
}
