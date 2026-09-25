"use client";

import Link from "next/link";
import { useLiveConnection } from "./LiveConnectionProvider";

// ヘッダーに常駐する接続状態の表示。ページを移動しても接続が続いていることが分かり、
// どこからでも止められるようにする（/live へ戻らなくても停止できる）。

export function LiveStatusIndicator() {
  const { status, autoConnectPhase, audioReady, enableAudio, stop, gifts } = useLiveConnection();

  const connected = status === "polling";
  const waiting = autoConnectPhase === "waiting" || autoConnectPhase === "connecting";
  if (!connected && !waiting) return null;

  return (
    <div className="flex items-center gap-1.5">
      {connected ? (
        <>
          <Link
            href="/live"
            className="flex min-h-11 items-center gap-1.5 rounded-full bg-status-success/10 px-3 text-xs font-bold text-status-success"
            title={`ライブ接続中。ギフト ${gifts.length} 件`}
          >
            <span aria-hidden="true">🔴</span>
            <span className="hidden sm:inline">配信中・接続済み</span>
            <span className="sm:hidden">接続中</span>
          </Link>
          <button type="button" onClick={stop} className="min-h-11 rounded-full bg-muted px-3 text-xs text-foreground hover:bg-muted/70">
            停止
          </button>
        </>
      ) : (
        <Link href="/live" className="flex min-h-11 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-bold text-primary" title="配信開始を待っています">
          <span className="hidden sm:inline">待機中（自動接続ON）</span>
          <span className="sm:hidden">待機中</span>
        </Link>
      )}
      {!audioReady && (
        <button
          type="button"
          onClick={() => void enableAudio()}
          className="min-h-11 rounded-full border border-status-warning/40 bg-status-warning/10 px-3 text-xs font-bold text-status-warning"
          title="ブラウザの自動再生制限のため、一度押して音を有効にしてください"
        >
          🔊 音を有効にする
        </button>
      )}
    </div>
  );
}
