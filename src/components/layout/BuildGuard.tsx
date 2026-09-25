"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// デプロイ後に Service Worker が古い JS を配り続ける問題への対策（全ページ共通）。
// 2026-09-25: Supabase URL を直して再デプロイしたあとも、ブラウザは古いバンドル（URL が違う版）のままで
// 「ログインが必要です」になった。/live にだけあった食い違い検知を全ページに広げ、更新ボタンで
// Service Worker を解除してから再読み込みする。

/** このバンドルのビルド識別子（deploy.yml が NEXT_PUBLIC_BUILD_ID=コミット SHA を埋め込む） */
const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown";
/** 確認の間隔。タブが前面に戻るたびに見るが、連続では叩かない */
const MIN_CHECK_INTERVAL_MS = 60_000;

export function BuildGuard() {
  const [serverBuildId, setServerBuildId] = useState<string | null>(null);
  const lastCheckedRef = useRef(0);

  const check = useCallback(async () => {
    if (Date.now() - lastCheckedRef.current < MIN_CHECK_INTERVAL_MS) return;
    lastCheckedRef.current = Date.now();
    try {
      const r = await fetch("/api/build", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { buildId?: string };
      if (typeof d.buildId === "string") setServerBuildId(d.buildId);
    } catch {
      // 回線瞬断などは無視（次の機会に見る）
    }
  }, []);

  useEffect(() => {
    // 初回は描画後に非同期で確認する（effect 内で同期的に setState しない）
    const t = setTimeout(() => void check(), 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  const reload = async () => {
    try {
      // 古い JS を配っている Service Worker を解除してから読み直す（解除しないと再読み込みでも古いまま）
      const regs = await navigator.serviceWorker?.getRegistrations();
      await Promise.all((regs ?? []).map((r) => r.unregister()));
      const keys = await caches?.keys();
      await Promise.all((keys ?? []).map((k) => caches.delete(k)));
    } catch {
      // 解除できなくても再読み込みは試す
    }
    window.location.reload();
  };

  // ビルド ID が取れない環境（ローカル開発）や一致している間は何も出さない
  if (!serverBuildId || serverBuildId === "unknown" || CLIENT_BUILD_ID === "unknown" || serverBuildId === CLIENT_BUILD_ID) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-status-warning/40 bg-status-warning/10 px-4 py-2">
      <span className="text-xs font-bold text-status-warning">新しいバージョンがあります</span>
      <span className="text-xs text-muted-foreground">この画面は古い JS のままです。ログインや音源の設定が失敗する場合は更新してください</span>
      <button type="button" onClick={() => void reload()} className="ml-auto min-h-9 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90">
        更新
      </button>
    </div>
  );
}
