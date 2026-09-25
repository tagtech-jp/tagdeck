"use client";

import { useEffect } from "react";
import { playSe } from "@/lib/se/engine";
import { tierForGift, TIER_LABELS, type SeTier } from "@/lib/se/tiers";
import { ACTIVE_WINDOW_MS, POLL_INTERVAL_MS, pollIntervalFor } from "@/lib/live/polling";
import { CLIENT_BUILD_ID, useLiveConnection } from "./LiveConnectionProvider";
import type { WsState } from "@/lib/live/ws-feed";
import { retryCountdownSec } from "@/lib/live/master-retry";
import type { NormalizedGift as Gift } from "@/lib/whowatch/gift-normalize";
import { VolumeSlider } from "./VolumeSlider";

// S1: ライブページの画面。接続状態そのものは LiveConnectionProvider が持っている
// （ページを移動しても接続と SE 再生が続くようにするため）。ここは表示と操作だけを担当する。

type Status = "idle" | "checking" | "offline" | "notfound" | "polling" | "error";

function stats(values: number[]): { avg: number; max: number; n: number } | null {
  if (values.length === 0) return null;
  return { avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length), max: Math.max(...values), n: values.length };
}
function fmt(s: { avg: number; max: number; n: number } | null): string {
  return s ? `平均 ${s.avg}ms / 最大 ${s.max}ms（${s.n}件）` : "—";
}

/** ユーザー不在（notfound）と非配信（offline）は別表示にする */
const STATUS_BADGE: Record<Status, { label: string; className: string }> = {
  idle: { label: "未接続", className: "bg-muted text-muted-foreground" },
  checking: { label: "確認中", className: "bg-muted text-muted-foreground" },
  offline: { label: "非配信", className: "bg-status-warning/10 text-status-warning" },
  notfound: { label: "ID未検出", className: "bg-destructive/10 text-destructive" },
  polling: { label: "🔴 配信中・接続済み", className: "bg-status-success/10 text-status-success" },
  error: { label: "エラー", className: "bg-destructive/10 text-destructive" },
};

/** WS 経路の状態表示（決裁 2026-09-25）。ポーリングは常に動いているので、WS が無くても配信は追える */
const WS_BADGE: Record<WsState, { label: string; className: string }> = {
  off: { label: "", className: "" },
  connecting: { label: "即時経路: 接続中", className: "bg-muted text-muted-foreground" },
  open: { label: "即時経路: 接続済み", className: "bg-status-success/10 text-status-success" },
  reconnecting: { label: "即時経路: 再接続中", className: "bg-status-warning/10 text-status-warning" },
  failed: { label: "即時経路: 使えず（ポーリングで動作中）", className: "bg-status-warning/10 text-status-warning" },
};

const TEST_GIFTS: Array<{ label: string; tier: SeTier; gift: Partial<Gift> }> = [
  { label: TIER_LABELS.T0, tier: "T0", gift: { item_name: "オータムリース", price_yen: 0, count: 1 } },
  { label: "〜¥499（チャイム・短）", tier: "T1", gift: { item_name: "ぶたさん", price_yen: 160, count: 1 } },
  { label: "¥500〜（チャイム）", tier: "T2", gift: { item_name: "ぶたさん ×4", price_yen: 160, count: 4 } },
  { label: "¥2,000〜（ファンファーレ・短）", tier: "T3", gift: { item_name: "花火", price_yen: 1000, count: 2 } },
  { label: "¥5,000〜（ファンファーレ）", tier: "T4", gift: { item_name: "大花火 ×3", price_yen: 2000, count: 3 } },
  { label: "当たり（ジングル）", tier: "hit", gift: { item_name: "ひよこのあたり", price_yen: 0, count: 1, is_hit: true } },
];

export function LiveCockpit({ debug = false }: { debug?: boolean }) {
  const {
    status,
    liveId,
    title,
    message,
    gifts,
    rawLog,
    autoPlay,
    setAutoPlay,
    volume,
    setVolume,
    audioReady,
    enableAudio,
    pollingInterval,
    lastPolledAt,
    targetId,
    setTargetId,
    viewingOther,
    selfByTypedId,
    masterWarning,
    master,
    masterFilledCount,
    masterPatternCount,
    masterRecovered,
    serverBuildId,
    lastGiftAt,
    pollLog,
    giftLog,
    wsState,
    wsGiftCount,
    wsInfo,
    wsTopic,
    wsLog,
    autoConnectPhase,
    setAutoConnect,
    start,
    stop,
    playGift,
    pushTestGift,
    setDebug,
  } = useLiveConnection();

  // ?debug=1 のときだけ生コメントと計測ログを集める（既定では通信量を増やさない）
  useEffect(() => {
    setDebug(debug);
  }, [debug, setDebug]);

  const waiting = autoConnectPhase === "waiting" || autoConnectPhase === "connecting";
  const badge = status === "polling" ? STATUS_BADGE.polling : waiting ? { label: "待機中（自動接続ON）", className: "bg-primary/10 text-primary" } : STATUS_BADGE[status];

  return (
    <div className="space-y-4">
      {/* 接続状態 */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-1 text-xs font-bold ${badge.className}`}>{badge.label}</span>
          {waiting && !audioReady && <span className="rounded-full bg-status-warning/10 px-2 py-1 text-xs font-bold text-status-warning">音声未許可</span>}
          {viewingOther && <span className="rounded-full bg-status-warning/10 px-2 py-1 text-xs font-bold text-status-warning">{viewingOther}さんを表示のみ・記録しません</span>}
          {selfByTypedId && <span className="rounded-full bg-status-success/10 px-2 py-1 text-xs font-bold text-status-success">自分の配信として記録します</span>}
          {status === "polling" && wsState !== "off" && (
            <span className={`rounded-full px-2 py-1 text-xs font-bold ${WS_BADGE[wsState].className}`} title={wsInfo ?? undefined}>
              {WS_BADGE[wsState].label}
              {wsState === "open" ? `（${wsGiftCount} 件受信）` : ""}
            </span>
          )}
          {liveId && (
            <span className="text-xs text-muted-foreground">
              live_id {liveId}
              {title ? ` · ${title}` : ""} · ポーリング {Math.round(pollIntervalFor({ isOther: viewingOther !== null, serverIntervalMs: pollingInterval, lastGiftAt, now: Date.now(), wsDelivering: wsState === "open" && wsGiftCount > 0 }) / 1000)} 秒間隔
              {lastPolledAt ? ` · 最終取得 ${new Date(lastPolledAt).toLocaleTimeString("ja-JP")}` : ""}
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <input type="checkbox" checked={autoConnectPhase !== "off"} onChange={(e) => {
                  setAutoConnect(e.target.checked);
                  // 解除はユーザー操作の中でしかできない。ON にした操作をその機会として使う
                  if (e.target.checked) void enableAudio();
                }} className="size-4" />
              配信開始時に自動接続
            </label>
            {!audioReady && (
              <button type="button" onClick={() => void enableAudio()} className="min-h-11 rounded-full border border-status-warning/40 bg-status-warning/10 px-3 text-xs font-bold text-status-warning">
                🔊 音を有効にする
              </button>
            )}
            {status !== "polling" ? (
              <button type="button" onClick={() => void start()} className="min-h-11 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                接続
              </button>
            ) : (
              <button type="button" onClick={stop} className="min-h-11 rounded-full bg-muted px-4 text-sm text-foreground">
                停止
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 space-y-1">
          <label htmlFor="live-target-id" className="text-xs font-medium text-foreground">
            配信者ID（空欄なら設定の自分のID）
          </label>
          <input
            id="live-target-id"
            type="text"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="例: Thomas19981022 / w:xxx / t:xxx / プロフィールURL"
            autoComplete="off"
            disabled={status === "polling"}
            className="min-h-11 w-full rounded-sm border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          <p className="text-xs text-muted-foreground">他の配信者を入力して接続した場合は表示のみで、ギフトは記録しません（設定のふわっちIDは変わりません）。</p>
          <p className="text-xs text-muted-foreground">接続したまま他のページへ移動しても SE は鳴り続けます（停止を押すまで）。ただしブラウザのタブを閉じると止まります。</p>
        </div>
        {serverBuildId && serverBuildId !== CLIENT_BUILD_ID && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-status-warning/40 bg-status-warning/10 p-2">
            <span className="text-xs font-bold text-status-warning">新しいバージョンがあります</span>
            <span className="text-xs text-muted-foreground">この画面は古いままです。計測値も古い版のものになります</span>
            <button type="button" onClick={() => window.location.reload()} className="ml-auto min-h-9 rounded-full bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90">
              更新
            </button>
          </div>
        )}
        {message && <p className="mt-2 text-xs text-status-warning">{message}</p>}
        {masterWarning && <p className="mt-2 text-xs font-bold text-destructive">{masterWarning}</p>}
        {masterRecovered && <p className="mt-2 text-xs font-bold text-status-success">アイテム情報を復旧しました</p>}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-2 text-foreground">
            <input type="checkbox" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} className="size-4" />
            ギフト検知で SE を自動再生
          </label>
          <VolumeSlider
            value={volume}
            onChange={setVolume}
            onCommit={setVolume}
            onPreview={(v) => {
              void (async () => {
                await enableAudio();
                await playSe("T2", { volume: v / 100 });
              })();
            }}
          />
          {!audioReady && <span className="text-muted-foreground">※ 最初にテストボタンか「接続」を押すと音が有効になります（ブラウザの自動再生制限）</span>}
        </div>
      </div>

      {/* テストボタン: 各ティア・当たり・コンボ（ダミー再生） */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-xs text-muted-foreground">テスト再生（既定 SE は Web Audio 合成。SE タブで割り当てた音源があればそれを再生）</p>
        <div className="flex flex-wrap gap-2">
          {TEST_GIFTS.map((t) => (
            <button
              key={t.tier}
              type="button"
              onClick={async () => {
                await enableAudio();
                await playGift({ pattern_id: null, item_id: null, price_yen: t.gift.price_yen ?? 0, count: t.gift.count ?? 1, is_hit: Boolean(t.gift.is_hit), kind: null, groups: [] }, t.tier);
                pushTestGift({ comment_id: `test-${Date.now()}`, pattern_id: null, item_id: null, item_name: `[テスト] ${t.gift.item_name}`, pattern_name: null, count: t.gift.count ?? 1, is_hit: Boolean(t.gift.is_hit), hit_grade: null, kind: null, price_yen: t.gift.price_yen ?? 0, groups: [], message: TIER_LABELS[t.tier], posted_at: new Date().toISOString(), user: { id: null, name: "テスト", user_path: null, anonymized: false } });
              }}
              className="min-h-11 rounded-full border border-border bg-muted px-3 text-xs text-foreground hover:border-foreground/30"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 直近のギフト */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h4 className="mb-2 text-sm font-bold text-foreground">直近のギフト</h4>
        {gifts.length === 0 ? (
          <p className="text-xs text-muted-foreground">まだギフトはありません</p>
        ) : (
          <div className="space-y-0.5">
            {gifts.map((g) => (
              <div key={g.comment_id} className="flex items-center gap-2 border-b border-border py-1.5 text-xs last:border-0">
                <span className="w-14 shrink-0 font-mono text-muted-foreground">{g.posted_at ? new Date(g.posted_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "--:--"}</span>
                <span className="w-24 shrink-0 truncate text-foreground">{g.user.anonymized ? "匿名" : (g.user.name ?? "?")}</span>
                <span className="flex-1 truncate text-foreground">
                  {g.item_name ?? `不明なアイテム（#${g.pattern_id ?? "?"}）`}
                  {g.pattern_name && g.pattern_name !== g.item_name ? `（${g.pattern_name}）` : ""}
                  {g.count > 1 ? ` ×${g.count}` : ""}
                </span>
                {g.is_hit && <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-status-warning">当たり</span>}
                {g.pattern_id !== null && g.item_name === null && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive" title="アイテム情報が無いため、当たり・演出付きを判別できていません">簡易判定</span>}
                <span className="shrink-0 font-mono text-muted-foreground">{g.price_yen !== null ? `¥${(g.price_yen * g.count).toLocaleString()}` : "—"}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{tierForGift({ priceYen: g.price_yen, count: g.count, isHit: g.is_hit })}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {debug && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="mb-2 text-sm font-bold text-foreground">計測モード（?debug=1）: ギフトが鳴るまでの遅延</h4>
          <div className="mb-3 grid gap-1 text-xs text-foreground sm:grid-cols-2">
            <div>実効ポーリング間隔: {fmt(stats(pollLog.map((p) => p.gapMs).filter((v) => v > 0)))}</div>
            <div>往復（ブラウザ→Workers→ふわっち）: {fmt(stats(pollLog.map((p) => p.rttMs)))}</div>
            <div className="font-bold">前景（レスポンスを返すまで待った時間）: {fmt(stats(pollLog.map((p) => p.server?.total ?? 0).filter((v) => v > 0)))}</div>
            <div>　├ 認証(Supabase): {fmt(stats(pollLog.map((p) => p.server?.auth ?? 0).filter((v) => v > 0)))}</div>
            <div>　├ ふわっちAPI: {fmt(stats(pollLog.map((p) => p.server?.upstream ?? 0).filter((v) => v > 0)))}</div>
            <div>　└ その他（合計−認証−API）: {fmt(stats(pollLog.map((p) => (p.server ? Math.max(0, p.server.total - p.server.auth - p.server.upstream) : 0))))}
              <span className="ml-1 text-muted-foreground">← ここが大きければ前景で何かを待っている</span>
            </div>
            <div>背景（レスポンス後・待っていない）: プロフィール取得・パターン照合・保存。所要は Worker のログに出る</div>
            <div className="font-bold text-status-warning">投げられた→SEが鳴るまで（補正済）: {fmt(stats(giftLog.map((g) => g.totalMs).filter((v): v is number => v !== null)))}</div>
            <div>投げられた→SEが鳴るまで（補正なし・生）: {fmt(stats(giftLog.map((g) => g.rawTotalMs).filter((v): v is number => v !== null)))}</div>
            <div>タブ非表示でのポーリング: {pollLog.filter((p) => p.hidden).length} / {pollLog.length} 回</div>
            <div>Worker 実行拠点（cf-ray）: {[...new Set(pollLog.map((p) => p.colo).filter(Boolean))].join(", ") || "—"}</div>
            <div>対策A（保存を待たない）: {pollLog.filter((p) => p.deferredSave).length} / {pollLog.length} 回 バックグラウンド保存</div>
            <div className={wsState === "open" ? "font-bold text-status-success" : wsState === "failed" ? "font-bold text-status-warning" : ""}>
              即時経路（WebSocket）: {WS_BADGE[wsState].label || "未使用"} / 購読 {wsTopic ?? "—"} / WS 経由のギフト {wsGiftCount} 件
              {wsInfo ? ` / ${wsInfo}` : ""}
              {wsState === "open" && wsGiftCount === 0 && " ← 接続はできているがギフトを解釈できていない。下の WS 生ログを確認"}
            </div>
            <div>
              投げられた→SE（経路別）: WS {fmt(stats(giftLog.filter((g) => g.source === "ws").map((g) => g.totalMs).filter((v): v is number => v !== null)))} / ポーリング {fmt(stats(giftLog.filter((g) => g.source === "poll").map((g) => g.totalMs).filter((v): v is number => v !== null)))}
            </div>
            <div>
              対策F（盛り上がり時だけ短縮）: 現在 {Math.round(pollIntervalFor({ isOther: viewingOther !== null, serverIntervalMs: pollingInterval, lastGiftAt, now: Date.now(), wsDelivering: wsState === "open" && wsGiftCount > 0 }) / 1000)} 秒間隔
              {lastGiftAt ? `（最後のギフトから ${Math.round((Date.now() - lastGiftAt) / 1000)} 秒）` : "（ギフト未検知）"}
              {" / 理由: "}
              {pollingInterval > POLL_INTERVAL_MS.idle
                ? `ふわっちが ${Math.round(pollingInterval / 1000)} 秒を指示`
                : viewingOther !== null
                  ? "他人の配信のため固定"
                  : wsState === "open" && wsGiftCount > 0
                    ? "WS がギフトを届けているのでポーリングは保存用の通常間隔"
                    : lastGiftAt === null || Date.now() - lastGiftAt > ACTIVE_WINDOW_MS
                      ? "静かなので通常間隔"
                      : "盛り上がり中のため短縮"}
            </div>
            <div className={master.ready ? "" : "font-bold text-destructive"}>
              マスタ: {master.ready ? `正常（${masterPatternCount.toLocaleString()}パターン）` : `縮退中（サーバ照合で補完 ${masterFilledCount} 件）`}
              {!master.ready && ` / リトライ: ${master.failureCount}回目、次まで ${retryCountdownSec(master, Date.now()) ?? "—"}秒`}
            </div>
            <div className={serverBuildId && serverBuildId !== CLIENT_BUILD_ID ? "font-bold text-destructive" : ""}>
              ビルド: 画面 {CLIENT_BUILD_ID.slice(0, 7)} / サーバ {(serverBuildId ?? "—").slice(0, 7)}
              {serverBuildId && serverBuildId !== CLIENT_BUILD_ID ? " ← 食い違い。この数字は古い版のものです" : ""}
            </div>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">
            ※ ふわっちの posted_at は秒単位のため ±500ms の誤差を含む。時計ズレ補正は Worker の時計（serverNow）基準（直近 {giftLog[0]?.skewMs ?? "—"} ms）。
            補正済と生の差が大きいときは補正側を疑うこと
          </p>
          {giftLog.length > 0 && (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2 font-medium">時刻</th>
                    <th className="py-1 pr-2 font-medium">経路</th>
                    <th className="py-1 pr-2 font-medium">ギフト</th>
                    <th className="py-1 pr-2 font-medium">パターン</th>
                    <th className="py-1 pr-2 font-medium">投稿→受信</th>
                    <th className="py-1 pr-2 font-medium">投稿→SE(補正)</th>
                    <th className="py-1 pr-2 font-medium">投稿→SE(生)</th>
                    <th className="py-1 pr-2 font-medium">ズレ</th>
                    <th className="py-1 font-medium">SE再生(鳴り終わりまで)</th>
                  </tr>
                </thead>
                <tbody className="text-foreground">
                  {giftLog.map((g) => (
                    <tr key={`${g.at}-${g.label}`} className="border-t border-border">
                      <td className="py-1 pr-2 font-mono">{new Date(g.at).toLocaleTimeString("ja-JP")}</td>
                      <td className={`py-1 pr-2 font-mono ${g.source === "ws" ? "text-status-success" : ""}`}>{g.source === "ws" ? "WS" : "poll"}</td>
                      <td className="py-1 pr-2 truncate">{g.label}</td>
                      <td className="py-1 pr-2 truncate font-mono">
                        {g.patternId ?? "—"} {g.patternName ?? ""} {g.kind ? `[${g.kind}]` : ""}
                      </td>
                      <td className="py-1 pr-2 font-mono">{g.arrivalMs ?? "—"}</td>
                      <td className="py-1 pr-2 font-mono font-bold">{g.totalMs ?? "—"}</td>
                      <td className="py-1 pr-2 font-mono">{g.rawTotalMs ?? "—"}</td>
                      <td className="py-1 pr-2 font-mono">{g.skewMs ?? "—"}</td>
                      <td className="py-1 font-mono">{g.seMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">時刻</th>
                  <th className="py-1 pr-2 font-medium">間隔</th>
                  <th className="py-1 pr-2 font-medium">往復</th>
                  <th className="py-1 pr-2 font-medium">サーバ(認証/API)</th>
                  <th className="py-1 pr-2 font-medium">拠点</th>
                  <th className="py-1 pr-2 font-medium">非表示</th>
                  <th className="py-1 pr-2 font-medium">保存</th>
                  <th className="py-1 font-medium">新ギフト</th>
                </tr>
              </thead>
              <tbody className="text-foreground">
                {pollLog.map((p) => (
                  <tr key={p.at} className="border-t border-border">
                    <td className="py-1 pr-2 font-mono">{new Date(p.at).toLocaleTimeString("ja-JP")}</td>
                    <td className="py-1 pr-2 font-mono">{p.gapMs || "—"}</td>
                    <td className="py-1 pr-2 font-mono">{p.rttMs}</td>
                    <td className="py-1 pr-2 font-mono">{p.server ? `${p.server.total} (${p.server.auth}/${p.server.upstream})` : "—"}</td>
                    <td className="py-1 pr-2 font-mono">{p.colo ?? "—"}</td>
                    <td className="py-1 pr-2">{p.hidden ? "hidden" : ""}</td>
                    <td className="py-1 pr-2">{p.deferredSave ? "非同期" : "—"}</td>
                    <td className="py-1 font-mono">{p.gifts || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {debug && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="mb-1 text-sm font-bold text-foreground">学習モード（?debug=1）: WebSocket 生ログ 直近 200 件</h4>
          <p className="mb-2 text-xs text-muted-foreground">
            コメントサーバから届いたメッセージをそのまま表示します（形式確定のための証跡）。「即時経路: 接続済み」なのに WS 経由のギフトが 0 件のままなら、ここの内容をそのまま渡してください
          </p>
          {wsLog.length === 0 ? <p className="text-xs text-muted-foreground">まだ受信していません（{WS_BADGE[wsState].label || "未接続"}{wsInfo ? ` / ${wsInfo}` : ""}）</p> : <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-2 text-[10px] leading-tight text-foreground">{JSON.stringify(wsLog, null, 1)}</pre>}
        </div>
      )}

      {debug && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h4 className="mb-2 text-sm font-bold text-foreground">学習モード（?debug=1）: 受信コメント生データ 直近 200 件</h4>
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-2 text-[10px] leading-tight text-foreground">{JSON.stringify(rawLog, null, 1)}</pre>
        </div>
      )}
    </div>
  );
}
