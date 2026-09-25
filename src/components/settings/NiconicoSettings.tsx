"use client";

import { useState, useEffect } from "react";
import { PlatformIdInput } from "./PlatformIdInput";

export function NiconicoSettings() {
  const [userId, setUserId] = useState("");
  const [savedUserId, setSavedUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/platforms/niconico/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data.niconicoUserId) {
          setUserId(data.niconicoUserId);
          setSavedUserId(data.niconicoUserId);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/platforms/niconico/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "ニコニコユーザー ID を保存しました" });
        setSavedUserId(data.niconicoUserId);
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
        id="niconicoUserId"
        label="ニコニコユーザー ID"
        platform="niconico"
        value={userId}
        onChange={setUserId}
        placeholder="例：12345678"
        helpText="ニコニコの URL の数字部分（例：nicovideo.jp/user/12345678）。プロフィールURLを貼り付けても自動抽出します"
      />
      <button
        type="submit"
        disabled={saving || !userId.trim()}
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
      {savedUserId && (
        <div className="space-y-1 rounded-lg bg-muted p-3 text-xs">
          <div>
            <span className="text-muted-foreground">登録済み: </span>
            <span className="font-mono text-foreground">{savedUserId}</span>
          </div>
        </div>
      )}
    </form>
  );
}
