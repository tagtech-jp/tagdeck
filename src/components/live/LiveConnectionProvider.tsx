"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getAudioContext, playSeUntilEnd, startKeepAlive, stopKeepAlive, unlockAudio } from "@/lib/se/engine";
import { createSeQueue } from "@/lib/se/queue";
import { resolveMappingKey, tierForGift, type SeTier } from "@/lib/se/tiers";
import { nextPollDelay, partitionFreshGifts, pollIntervalFor } from "@/lib/live/polling";
import { idlePollInterval, INITIAL_AUTO_CONNECT_STATE, reduceAutoConnect, type AutoConnectPhase } from "@/lib/live/auto-connect";
import { INITIAL_MASTER_STATE, masterFailed, masterSucceeded, retryCountdownSec, type MasterState } from "@/lib/live/master-retry";
import { extractComments, isBacklogComment, parseWsMessage, WS_MAX_FAILURES_BEFORE_GIVE_UP, wsReconnectDelay, type WsState } from "@/lib/live/ws-feed";
import { commentsFromFrame, createRefCounter, decodeFrame, heartbeatFrame, joinCandidates, joinFrame, PHOENIX_HEARTBEAT_MS, phoenixSocketUrl, replyStatus, type JoinCandidate, type PhoenixFrame } from "@/lib/live/phoenix";
import { normalizeGift, type NormalizedGift as Gift, type PatternInfo, type PickedGiftComment } from "@/lib/whowatch/gift-normalize";
import type { ItemKind } from "@/lib/se/item-kind";

// ライブ接続の状態をアプリ全体で保持する Provider。
// (dashboard)/layout.tsx に置いてあるため、ページを移動しても接続と SE 再生が続く。
//
// 経路は 2 本（決裁 2026-09-25）:
//   1. ポーリング（/api/platforms/whowatch/live/poll）… 保存の経路。WS が切れた時の予備でもある
//   2. WebSocket（ふわっちのコメントサーバへブラウザから直接）… SE を即時に鳴らす経路
// 同じギフトが両方から届くので comment_id で重複を弾く（seenRef）。
// 止まるのは「停止」を押したときと、ブラウザのタブを閉じたときだけ（タブを閉じた場合は
// JavaScript ごと破棄されるため、これは技術的に避けられない）。

export interface Mapping {
  key: string;
  url: string | null;
  volume: number;
  enabled: boolean;
}
export interface PollTimings {
  total: number;
  auth: number;
  upstream: number;
}
interface PollResponse {
  liveId: string;
  liveStatus: string | null;
  updatedAt: number | null;
  serverNow?: number;
  pollingInterval: number;
  commentCount: number;
  giftComments: PickedGiftComment[];
  /** 縮退時だけ入る。サーバが照合したパターン情報 */
  patternInfo?: PatternInfo[];
  deferredSave: boolean;
  buildId?: string;
  timings?: PollTimings;
  rawComments: unknown[];
}
export interface ItemsPatternsResponse {
  items?: Array<{
    itemId: number;
    priceJpy: number | null;
    patterns: Array<{ patternId: number; patternName: string; isHit: boolean; hitGrade: string | null; quantity?: number | null; animationUrl: string | null; animationFullscreen: boolean }>;
    itemName: string;
    groups?: string[];
  }>;
}

export interface PollSample {
  at: number;
  gapMs: number;
  rttMs: number;
  server: PollTimings | null;
  hidden: boolean;
  colo: string | null;
  gifts: number;
  deferredSave: boolean;
}
interface QueuedGift {
  gift: Gift;
  receivedAt: number;
  skewMs: number | null;
  source: GiftSource;
}
export type GiftSource = "ws" | "poll";
/** WS の生メッセージ（?debug=1 の学習モード用）。形式確定のための証跡 */
export interface WsLogEntry {
  at: number;
  data: unknown;
}
export interface GiftSample {
  at: number;
  label: string;
  /** どの経路で届いたか */
  source: GiftSource;
  patternId: number | null;
  patternName: string | null;
  kind: ItemKind | null;
  arrivalMs: number | null;
  totalMs: number | null;
  rawTotalMs: number | null;
  /** 受信→鳴り始めまでの待ち（SE キューで前の音を待った時間）。ネットワークとは無関係な分 */
  queueMs: number;
  seMs: number;
  skewMs: number | null;
}

export type Status = "idle" | "checking" | "offline" | "notfound" | "polling" | "error";

/** このバンドルのビルド識別子。Worker の値と食い違えば古い JS で動いている（Service Worker 対策） */
export const CLIENT_BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown";
const AUTO_CONNECT_STORAGE_KEY = "tagdeck.live.autoConnect";

interface LiveConnectionValue {
  status: Status;
  liveId: string | null;
  title: string | null;
  message: string | null;
  gifts: Gift[];
  rawLog: unknown[];
  autoPlay: boolean;
  setAutoPlay: (v: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
  audioReady: boolean;
  enableAudio: () => Promise<void>;
  pollingInterval: number;
  lastPolledAt: string | null;
  mappings: Mapping[];
  targetId: string;
  setTargetId: (v: string) => void;
  viewingOther: string | null;
  /** 配信者ID欄に入力したが自分の配信だった（＝通常どおり記録される） */
  selfByTypedId: boolean;
  masterWarning: string | null;
  /** マスタの状態。縮退中はサーバ照合で補っている */
  master: MasterState;
  /** 縮退中にサーバ照合で補ったパターン数 */
  masterFilledCount: number;
  /** キャッシュ済みパターン数（正常時の件数表示用） */
  masterPatternCount: number;
  /** 復帰直後に短く出すお知らせ */
  masterRecovered: boolean;
  serverBuildId: string | null;
  lastGiftAt: number | null;
  pollLog: PollSample[];
  giftLog: GiftSample[];
  /** WebSocket 経路の状態 */
  wsState: WsState;
  /** WS 経由で受け取ったギフト数（0 のままなら形式が合っていない可能性） */
  wsGiftCount: number;
  /** WS の直近の切断理由など（表示用） */
  wsInfo: string | null;
  /** 購読できたチャンネル名（Phoenix のトピック）。未購読なら null */
  wsTopic: string | null;
  /** WS の生メッセージ（?debug=1 のときだけ溜める） */
  wsLog: WsLogEntry[];
  /** 自動接続の状態。off 以外はチェックボックスが ON */
  autoConnectPhase: AutoConnectPhase;
  setAutoConnect: (on: boolean) => void;
  start: () => Promise<void>;
  stop: () => void;
  playGift: (g: Pick<Gift, "pattern_id" | "item_id" | "price_yen" | "count" | "is_hit" | "kind"> & { groups?: string[] }, forceTier?: SeTier, waitForEnd?: boolean) => Promise<void>;
  pushTestGift: (g: Gift) => void;
  /** ?debug=1 のときだけ生コメントと計測ログを集める */
  setDebug: (v: boolean) => void;
  debug: boolean;
}

const LiveConnectionContext = createContext<LiveConnectionValue | null>(null);

export function useLiveConnection(): LiveConnectionValue {
  const ctx = useContext(LiveConnectionContext);
  if (!ctx) throw new Error("useLiveConnection は LiveConnectionProvider の内側で使ってください");
  return ctx;
}

export function LiveConnectionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("idle");
  const [liveId, setLiveId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [rawLog, setRawLog] = useState<unknown[]>([]);
  const [autoPlay, setAutoPlay] = useState(true);
  const [volume, setVolume] = useState(80);
  const [audioReady, setAudioReady] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<number>(10_000);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [targetId, setTargetId] = useState("");
  const [viewingOther, setViewingOther] = useState<string | null>(null);
  // 配信者ID欄に入力したうえで自分の配信と判定された状態。空欄のときと区別できないと
  // 「他人扱いになって記録されていないのでは」という誤解を生む
  const [selfByTypedId, setSelfByTypedId] = useState(false);
  const [masterWarning, setMasterWarning] = useState<string | null>(null);
  const [master, setMaster] = useState<MasterState>(INITIAL_MASTER_STATE);
  const [masterFilledCount, setMasterFilledCount] = useState(0);
  const [masterPatternCount, setMasterPatternCount] = useState(0);
  const [masterRecovered, setMasterRecovered] = useState(false);
  const [serverBuildId, setServerBuildId] = useState<string | null>(null);
  const [lastGiftAt, setLastGiftAt] = useState<number | null>(null);
  const [pollLog, setPollLog] = useState<PollSample[]>([]);
  const [giftLog, setGiftLog] = useState<GiftSample[]>([]);
  const [wsState, setWsState] = useState<WsState>("off");
  const [wsGiftCount, setWsGiftCount] = useState(0);
  const [wsInfo, setWsInfo] = useState<string | null>(null);
  const [wsTopic, setWsTopic] = useState<string | null>(null);
  const [wsLog, setWsLog] = useState<WsLogEntry[]>([]);
  const [debug, setDebug] = useState(false);

  // 自動接続。チェック状態はブラウザに保存し、次に開いたときも待機から始める
  const [autoConnect, dispatchAutoConnect] = useReducer(reduceAutoConnect, INITIAL_AUTO_CONNECT_STATE, (init) => {
    try {
      if (typeof window !== "undefined" && localStorage.getItem(AUTO_CONNECT_STORAGE_KEY) === "1") {
        return { phase: "waiting" as const, waitingStartedAt: Date.now() };
      }
    } catch {
      // プライベートモード等で localStorage が使えない場合は OFF で始める
    }
    return init;
  });

  const lastUpdatedRef = useRef<number | string>(0);
  const seenRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const mappingsRef = useRef<Mapping[]>([]);
  const autoPlayRef = useRef(true);
  const volumeRef = useRef(80);
  const pollingIntervalRef = useRef(10_000);
  const readOnlyRef = useRef(false);
  const lastPollStartRef = useRef(0);
  const firstPollRef = useRef(true);
  const inFlightRef = useRef(false);
  const patternLookupRef = useRef<Map<number, PatternInfo>>(new Map());
  const masterFetchedAtRef = useRef(0);
  const lastGiftAtRef = useRef<number | null>(null);
  const masterRef = useRef<MasterState>(INITIAL_MASTER_STATE);
  /** 縮退中に「サーバへ聞いてまだ答えが来ていない」pattern_id。二重に聞かない */
  const askedPatternsRef = useRef<Set<number>>(new Set());
  const debugRef = useRef(false);
  const autoConnectRef = useRef(autoConnect);
  // ── WebSocket 経路 ──
  const wsRef = useRef<WebSocket | null>(null);
  const wsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsCandidatesRef = useRef<string[]>([]);
  /** 最後にメッセージを受け取ってからの連続切断回数（再接続の待ち時間に使う） */
  const wsClosesRef = useRef(0);
  /** この接続セッションで 1 つでもメッセージを受け取れたか（0 のまま失敗が続けば諦める） */
  const wsReceivedAnyRef = useRef(false);
  /** WS がギフトを実際に届けた実績（pollIntervalFor の wsDelivering） */
  const wsDeliveringRef = useRef(false);
  const wsConnectedAtRef = useRef(0);
  /** ポーリングで測った時計ズレの直近値。WS 経由のギフトの計測にも使う */
  const skewRef = useRef<number | null>(null);
  // ── Phoenix Channels（決裁 2026-09-25「送信も可」: 送るのは phx_join と heartbeat だけ） ──
  const wsJwtRef = useRef<string | null>(null);
  const wsLiveIdRef = useRef<string | null>(null);
  /** 参加候補（トピック × 参加データ。順に試す） */
  const wsJoinsRef = useRef<JoinCandidate[]>([]);
  /** 参加が通ったトピック */
  const wsTopicRef = useRef<string | null>(null);
  /** 返事待ちの phx_join（ref が一致する phx_reply を待つ。5 秒で次の候補へ） */
  const wsPendingJoinRef = useRef<{ ref: string; topic: string; idx: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const wsHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsNextRefRef = useRef<() => string>(createRefCounter());
  /** 全候補で参加を拒否された等、再接続しても無駄なとき true */
  const wsGiveUpRef = useRef(false);
  /** 参加に失敗した理由（表示用） */
  const wsJoinErrorsRef = useRef<string[]>([]);

  useEffect(() => {
    mappingsRef.current = mappings;
  }, [mappings]);
  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);
  useEffect(() => {
    pollingIntervalRef.current = pollingInterval;
  }, [pollingInterval]);
  useEffect(() => {
    lastGiftAtRef.current = lastGiftAt;
  }, [lastGiftAt]);
  useEffect(() => {
    debugRef.current = debug;
  }, [debug]);
  useEffect(() => {
    masterRef.current = master;
  }, [master]);
  useEffect(() => {
    autoConnectRef.current = autoConnect;
  }, [autoConnect]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTO_CONNECT_STORAGE_KEY, autoConnect.phase !== "off" ? "1" : "0");
    } catch {
      // 保存できなくても動作には影響しない
    }
  }, [autoConnect.phase]);

  useEffect(() => {
    fetch("/api/se/mappings")
      .then((r) => (r.ok ? (r.json() as Promise<{ mappings?: Mapping[] }>) : { mappings: [] }))
      .then((d: { mappings?: Mapping[] }) => setMappings(d.mappings ?? []))
      .catch(() => undefined);
  }, []);

  const applyPatternMaster = useCallback((pd: ItemsPatternsResponse | null): boolean => {
    if (!pd || (pd.items?.length ?? 0) === 0) return false;
    const map = new Map<number, PatternInfo>();
    for (const it of pd.items ?? []) {
      for (const p of it.patterns) {
        map.set(p.patternId, { patternId: p.patternId, itemId: it.itemId, itemName: it.itemName, patternName: p.patternName, isHit: p.isHit, hitGrade: p.hitGrade, quantity: p.quantity ?? null, priceJpy: it.priceJpy, animationUrl: p.animationUrl, animationFullscreen: p.animationFullscreen, groups: it.groups ?? [] });
      }
    }
    patternLookupRef.current = map;
    setMasterPatternCount(map.size);
    return true;
  }, []);

  /** マスタの取得結果を state に反映する。成功したら縮退から復帰した旨を短く出す */
  const recordMasterResult = useCallback((ok: boolean) => {
    if (ok) {
      const wasDegraded = !masterRef.current.ready && masterRef.current.failureCount > 0;
      masterRef.current = masterSucceeded();
      setMaster(masterRef.current);
      setMasterWarning(null);
      askedPatternsRef.current.clear();
      if (wasDegraded) {
        setMasterRecovered(true);
        setTimeout(() => setMasterRecovered(false), 6_000);
      }
    } else {
      masterRef.current = masterFailed(masterRef.current, Date.now());
      setMaster(masterRef.current);
      setMasterWarning("アイテム情報を取得できませんでした。当たり・演出付きの判別ができないため、ギフトが届くたびにサーバへ問い合わせて補っています（音が少し遅れます）。自動で復旧を試みています");
    }
  }, []);

  /** マスタを取り直す。成功可否を state に記録する */
  const fetchMaster = useCallback(async (): Promise<boolean> => {
    masterFetchedAtRef.current = Date.now();
    try {
      const res = await fetch("/api/platforms/whowatch/items/patterns");
      const ok = res.ok && applyPatternMaster((await res.json()) as ItemsPatternsResponse);
      recordMasterResult(ok);
      return ok;
    } catch {
      recordMasterResult(false);
      return false;
    }
  }, [applyPatternMaster, recordMasterResult]);

  /**
   * 未知の pattern_id を見たらマスタを取り直す（配信中にふわっちが新アイテムを出した場合の対策）。
   * 縮退中はバックオフ側のリトライに任せるので、ここでは何もしない
   */
  const refetchMasterIfStale = useCallback(
    async (missing: boolean) => {
      if (!missing || !masterRef.current.ready) return;
      if (Date.now() - masterFetchedAtRef.current < 60_000) return;
      await fetchMaster();
    },
    [fetchMaster],
  );

  /**
   * ギフト 1 件の SE を鳴らす。waitForEnd=true（キューからの呼び出し）なら鳴り終わるまで待つ。
   * 連続ギフトは前の音が終わってから次を鳴らす（重ねると長い音源で 2 発目以降が埋もれる）
   */
  const playGift = useCallback(async (g: Pick<Gift, "pattern_id" | "item_id" | "price_yen" | "count" | "is_hit" | "kind"> & { groups?: string[] }, forceTier?: SeTier, waitForEnd = false) => {
    const tier = forceTier ?? tierForGift({ priceYen: g.price_yen, count: g.count, isHit: g.is_hit });
    const target = { patternId: g.pattern_id, itemId: g.item_id, tier, kind: g.kind, groups: g.groups };
    const enabledKeys = new Set(mappingsRef.current.filter((m) => m.enabled).map((m) => m.key));
    const disabledKeys = new Set(mappingsRef.current.filter((m) => !m.enabled).map((m) => m.key));
    const key = resolveMappingKey(enabledKeys, target);
    if (!key && resolveMappingKey(disabledKeys, target)) return; // 明示的に無効化
    const m = key ? mappingsRef.current.find((x) => x.key === key) : undefined;
    const vol = (volumeRef.current / 100) * ((m?.volume ?? 80) / 100);
    await playSeUntilEnd(tier, { url: m?.url ?? null, volume: vol }, waitForEnd);
  }, []);

  const playQueued = useCallback(
    async (q: QueuedGift) => {
      const playedAt = Date.now();
      // 当たり判定はパターン名からの推定。実ログで精度を確かめられるよう残す
      if (q.gift.is_hit) console.info("[tagdeck] 当たり検知", { pattern_id: q.gift.pattern_id, pattern_name: q.gift.pattern_name, item_name: q.gift.item_name, hit_grade: q.gift.hit_grade, posted_at: q.gift.posted_at });
      // 計測用の seMs は「鳴り始めまで」を測りたいので、鳴り始めた時刻を先に確定させてから終わりを待つ
      await playGift(q.gift, undefined, true);
      if (!debugRef.current) return;
      const postedAt = q.gift.posted_at ? Date.parse(q.gift.posted_at) : null;
      setGiftLog((prev) =>
        [
          {
            at: playedAt,
            source: q.source,
            label: `${q.gift.item_name ?? `不明なアイテム（#${q.gift.pattern_id ?? "?"}）`}${q.gift.count > 1 ? ` ×${q.gift.count}` : ""}`,
            patternId: q.gift.pattern_id,
            patternName: q.gift.pattern_name,
            kind: q.gift.kind,
            arrivalMs: postedAt !== null && q.skewMs !== null ? q.receivedAt + q.skewMs - postedAt : null,
            totalMs: postedAt !== null && q.skewMs !== null ? playedAt + q.skewMs - postedAt : null,
            rawTotalMs: postedAt !== null ? playedAt - postedAt : null,
            queueMs: playedAt - q.receivedAt,
            seMs: Date.now() - playedAt,
            skewMs: q.skewMs,
          },
          ...prev,
        ].slice(0, 40),
      );
    },
    [playGift],
  );

  const seQueue = useMemo(() => createSeQueue<QueuedGift>({ play: playQueued }), [playQueued]);
  const seQueueRef = useRef(seQueue);
  useEffect(() => {
    seQueueRef.current = seQueue;
  }, [seQueue]);

  /** WS を閉じて再接続も止める。stop() と配信終了時に呼ぶ */
  const closeWs = useCallback(() => {
    if (wsTimerRef.current) clearTimeout(wsTimerRef.current);
    wsTimerRef.current = null;
    if (wsHeartbeatRef.current) clearInterval(wsHeartbeatRef.current);
    wsHeartbeatRef.current = null;
    if (wsPendingJoinRef.current) clearTimeout(wsPendingJoinRef.current.timer);
    wsPendingJoinRef.current = null;
    wsTopicRef.current = null;
    setWsTopic(null);
    const ws = wsRef.current;
    wsRef.current = null;
    wsDeliveringRef.current = false;
    if (ws) {
      try {
        ws.close();
      } catch {
        // 既に閉じている場合は何もしない
      }
    }
    setWsState("off");
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    closeWs();
    seQueueRef.current.clear();
    stopKeepAlive();
    setStatus("idle");
    // 自動接続が ON なら待機へ戻る（OFF ならそのまま止まる）
    dispatchAutoConnect({ type: "disconnected", now: Date.now() });
  }, [closeWs]);

  /**
   * パターン照合（ブラウザ側キャッシュ）。ポーリングと WS の両方で同じものを使う。
   * 縮退中は照合できなかった pattern_id を次のポーリングでサーバに聞く
   */
  const lookupPattern = useCallback((pid: number, onMissing: () => void): PatternInfo | null => {
    const info = patternLookupRef.current.get(pid);
    if (!info) {
      onMissing();
      if (!masterRef.current.ready) askedPatternsRef.current.add(pid);
    }
    return info ?? null;
  }, []);

  /**
   * 新着ギフトを画面と SE キューへ流す（経路共通）。
   * fresh = 未受信（画面に出す）、toPlay = そのうち鳴らすもの（接続前の分は鳴らさない）
   */
  const ingestFresh = useCallback((fresh: Gift[], toPlay: Gift[], receivedAt: number, skewMs: number | null, source: GiftSource) => {
    for (const g of fresh) seenRef.current.add(g.comment_id);
    if (fresh.length === 0) return;
    // 対策F: ギフトが来た＝盛り上がっている。ここから一定時間は間隔を詰める
    lastGiftAtRef.current = receivedAt;
    setLastGiftAt(receivedAt);
    setGifts((prev) => [...fresh.slice().reverse(), ...prev].slice(0, 100));
    // 一斉に鳴らすと同じ音が同位相で重なって 1 件に聞こえるため、キューで順番に鳴らす
    if (autoPlayRef.current && toPlay.length > 0) seQueueRef.current.push(toPlay.map((gift) => ({ gift, receivedAt, skewMs, source })));
  }, []);

  const pollOnce = useCallback(
    async (id: string) => {
      const dbg = debugRef.current;
      const startedAt = Date.now();
      const gapMs = lastPollStartRef.current ? startedAt - lastPollStartRef.current : 0;
      lastPollStartRef.current = startedAt;
      const hidden = typeof document !== "undefined" && document.hidden;
      // 縮退中だけ、まだ聞いていない pattern_id をサーバに照合してもらう（正常時は空＝DBに触らない）
      const needPatterns = masterRef.current.ready ? [] : [...askedPatternsRef.current].slice(0, 50);
      const res = await fetch("/api/platforms/whowatch/live/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveId: id, lastUpdatedAt: lastUpdatedRef.current, dryRun: readOnlyRef.current || (dbg && !autoPlayRef.current), debug: dbg, needPatterns }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as PollResponse;
      const receivedAt = Date.now();
      // 往復の中点で時計ズレを見る（NTP と同じ考え方）。serverNow は Worker 自身の Date.now()
      const skewMs = typeof d.serverNow === "number" ? d.serverNow - (startedAt + receivedAt) / 2 : null;
      if (skewMs !== null) skewRef.current = skewMs;
      if (d.updatedAt !== null) lastUpdatedRef.current = d.updatedAt;
      setPollingInterval(d.pollingInterval);
      setLastPolledAt(new Date().toISOString());
      if (d.buildId) setServerBuildId(d.buildId);
      // 縮退時にサーバが照合してくれた分をキャッシュへ取り込む（次からは問い合わせ不要）
      if (d.patternInfo?.length) {
        for (const info of d.patternInfo) {
          patternLookupRef.current.set(info.patternId, info);
          askedPatternsRef.current.delete(info.patternId);
        }
        setMasterFilledCount((n) => n + d.patternInfo!.length);
      }
      if (dbg && d.rawComments.length > 0) setRawLog((prev) => [...d.rawComments, ...prev].slice(0, 200));
      // 対策D: パターン照合はブラウザ側キャッシュで行う（DB往復を毎ポーリングで発生させない）
      let missingPattern = false;
      const normalized = d.giftComments.map((c) => normalizeGift(c, (pid) => lookupPattern(pid, () => (missingPattern = true))));
      void refetchMasterIfStale(missingPattern);
      const { fresh, toPlay } = partitionFreshGifts(normalized, seenRef.current, firstPollRef.current);
      firstPollRef.current = false;
      if (dbg) {
        const colo = res.headers.get("cf-ray")?.split("-")[1] ?? null;
        setPollLog((prev) => [{ at: startedAt, gapMs, rttMs: receivedAt - startedAt, server: d.timings ?? null, hidden, colo, gifts: fresh.length, deferredSave: d.deferredSave }, ...prev].slice(0, 60));
      }
      ingestFresh(fresh, toPlay, receivedAt, skewMs, "poll");
      if (d.liveStatus && d.liveStatus !== "PUBLISHING") {
        setMessage(`配信が終了しました（${d.liveStatus}）`);
        return false;
      }
      return true;
    },
    [ingestFresh, lookupPattern, refetchMasterIfStale],
  );

  // ── WebSocket 経路 ───────────────────────────────────────────────────────
  /**
   * 参加（phx_join）を候補トピックの順に試す。返事は handleWsMessage が ref で突き合わせる。
   * 全候補で拒否されたら諦めてポーリングだけで続ける（再接続はしない）
   */
  /** 返事待ちのタイマーから自分自身を呼ぶための参照（useCallback の中で自分を直接参照しない） */
  const tryJoinRef = useRef<(idx: number) => void>(() => {});
  const tryJoin = useCallback((idx: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const joins = wsJoinsRef.current;
    if (idx >= joins.length) {
      wsGiveUpRef.current = true;
      setWsState("failed");
      setWsInfo(`購読できる組み合わせが見つかりません（試した ${joins.length} 通り / 理由: ${wsJoinErrorsRef.current.join("; ") || "—"}）。ポーリングで続行`);
      try {
        ws.close(1000, "no topic");
      } catch {
        // 既に閉じていれば無視
      }
      return;
    }
    const cand = joins[idx];
    const ref = wsNextRefRef.current();
    ws.send(joinFrame(cand.topic, ref, cand.payload));
    if (wsPendingJoinRef.current) clearTimeout(wsPendingJoinRef.current.timer);
    wsPendingJoinRef.current = {
      ref,
      topic: cand.topic,
      idx,
      timer: setTimeout(() => {
        // 返事が来ない＝その組み合わせは無視されている。次へ
        if (wsPendingJoinRef.current?.ref !== ref) return;
        wsJoinErrorsRef.current.push(`${cand.label}: 返事なし`);
        wsPendingJoinRef.current = null;
        tryJoinRef.current(idx + 1);
      }, 5_000),
    };
    setWsInfo(`購読を試行中: ${cand.label}`);
  }, []);
  useEffect(() => {
    tryJoinRef.current = tryJoin;
  }, [tryJoin]);

  /** WS のメッセージ 1 件を処理する。Phoenix の V2 フレームとして読み、読めなければ従来の防御的解析に落とす */
  const handleWsMessage = useCallback(
    (ev: MessageEvent) => {
      const receivedAt = Date.now();
      const msg = parseWsMessage(ev.data);
      if (debugRef.current) setWsLog((prev) => [{ at: receivedAt, data: msg ?? (typeof ev.data === "string" ? ev.data.slice(0, 500) : String(ev.data)) }, ...prev].slice(0, 200));
      if (msg === null) return;
      const frame: PhoenixFrame | null = decodeFrame(ev.data);
      // 参加の返事（phx_reply）を ref で突き合わせる
      const pending = wsPendingJoinRef.current;
      if (frame && pending && frame.ref === pending.ref && frame.topic === pending.topic) {
        const st = replyStatus(frame);
        if (st === "ok") {
          clearTimeout(pending.timer);
          wsPendingJoinRef.current = null;
          const label = wsJoinsRef.current[pending.idx]?.label ?? pending.topic;
          wsTopicRef.current = pending.topic;
          setWsTopic(label);
          setWsInfo(`購読中: ${label}`);
          console.info("[tagdeck] WS 購読成功", { label, topic: pending.topic, keys: Object.keys(wsJoinsRef.current[pending.idx]?.payload ?? {}) });
          return;
        }
        if (st === "error") {
          clearTimeout(pending.timer);
          wsPendingJoinRef.current = null;
          const resp = (frame.payload as { response?: unknown } | null)?.response;
          const reason = (resp as { reason?: unknown } | null)?.reason;
          const label = wsJoinsRef.current[pending.idx]?.label ?? pending.topic;
          // reason が無い形式もあるので、返事の中身（先頭 120 文字）を残す
          wsJoinErrorsRef.current.push(`${label}: ${typeof reason === "string" ? reason : JSON.stringify(resp ?? frame.payload).slice(0, 120)}`);
          tryJoinRef.current(pending.idx + 1);
          return;
        }
      }
      // サーバ側からチャンネルが閉じられた／エラーになった場合は再接続に任せる（onclose が続く）
      if (frame && (frame.event === "phx_error" || frame.event === "phx_close") && frame.topic === wsTopicRef.current) {
        setWsInfo(`チャンネルが閉じられました（${frame.event}）。再接続します`);
        return;
      }
      const comments = (frame ? commentsFromFrame(frame) : extractComments(msg)).filter((c) => c.comment_type === "BY_PLAYITEM");
      if (comments.length === 0) return;
      let missingPattern = false;
      const normalized = comments.map((c) => normalizeGift(c, (pid) => lookupPattern(pid, () => (missingPattern = true))));
      void refetchMasterIfStale(missingPattern);
      const fresh: Gift[] = [];
      const toPlay: Gift[] = [];
      normalized.forEach((g, i) => {
        if (seenRef.current.has(g.comment_id)) return;
        fresh.push(g);
        // 接続直後に過去分がまとめて流れてきても鳴らさない（ポーリングの初回と同じ考え方）
        if (!isBacklogComment(comments[i].posted_at, wsConnectedAtRef.current)) toPlay.push(g);
      });
      if (fresh.length > 0) {
        wsDeliveringRef.current = true;
        setWsGiftCount((n) => n + fresh.length);
      }
      ingestFresh(fresh, toPlay, receivedAt, skewRef.current, "ws");
    },
    [ingestFresh, lookupPattern, refetchMasterIfStale],
  );
  const handleWsMessageRef = useRef(handleWsMessage);
  useEffect(() => {
    handleWsMessageRef.current = handleWsMessage;
  }, [handleWsMessage]);

  /** 再接続タイマーから自分自身を呼ぶための参照（useCallback の中で自分を直接参照しない） */
  const openWsRef = useRef<() => void>(() => {});
  /** コメントサーバへ接続し、開いたら heartbeat を始めて購読を試す。切れたらバックオフで再接続。ポーリングは止めない */
  const openWs = useCallback(() => {
    if (!runningRef.current || wsGiveUpRef.current) return;
    const url = wsCandidatesRef.current[0];
    if (!url) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      setWsState("failed");
      setWsInfo(`接続できません: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    wsRef.current = ws;
    setWsState(wsClosesRef.current > 0 ? "reconnecting" : "connecting");
    let gotMessage = false;
    let opened = false;
    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      opened = true;
      wsConnectedAtRef.current = Date.now();
      setWsState("open");
      setWsInfo(null);
      // Phoenix は一定時間 heartbeat が無いと切断する。30 秒ごとに送る（送るのはこれと phx_join だけ）
      if (wsHeartbeatRef.current) clearInterval(wsHeartbeatRef.current);
      wsHeartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(heartbeatFrame(wsNextRefRef.current()));
      }, PHOENIX_HEARTBEAT_MS);
      wsJoinErrorsRef.current = [];
      tryJoinRef.current(0);
    };
    ws.onmessage = (ev) => {
      if (wsRef.current !== ws) return;
      gotMessage = true;
      wsReceivedAnyRef.current = true;
      wsClosesRef.current = 0;
      handleWsMessageRef.current(ev);
    };
    ws.onclose = (ev) => {
      if (wsRef.current !== ws) return; // stop() で閉じた／差し替え済み
      wsRef.current = null;
      wsDeliveringRef.current = false;
      if (wsHeartbeatRef.current) clearInterval(wsHeartbeatRef.current);
      wsHeartbeatRef.current = null;
      if (wsPendingJoinRef.current) clearTimeout(wsPendingJoinRef.current.timer);
      wsPendingJoinRef.current = null;
      wsTopicRef.current = null;
      setWsTopic(null);
      if (!runningRef.current) {
        setWsState("off");
        return;
      }
      if (wsGiveUpRef.current) return; // tryJoin が諦めた（表示は設定済み）
      wsClosesRef.current += 1;
      // 1006 でも「握手で拒否された」のか「つながった後に切られた」のかで原因が違うので区別して残す
      const reason = `切断 code=${ev.code}${ev.reason ? ` ${ev.reason}` : ""}（${opened ? (gotMessage ? "受信後に切断" : "接続後・受信前に切断") : "接続前に失敗＝握手で拒否か URL/証明書の問題"}）`;
      if (!wsReceivedAnyRef.current && wsClosesRef.current >= WS_MAX_FAILURES_BEFORE_GIVE_UP) {
        setWsState("failed");
        setWsInfo(`${reason} / ${wsClosesRef.current} 回続けて受信できなかったため WS は諦め、ポーリングで続行`);
        return;
      }
      setWsState("reconnecting");
      setWsInfo(reason);
      wsTimerRef.current = setTimeout(() => openWsRef.current(), wsReconnectDelay(wsClosesRef.current));
    };
    ws.onerror = () => {
      // onclose が続けて呼ばれるので、ここでは何もしない
    };
  }, []);

  useEffect(() => {
    openWsRef.current = openWs;
  }, [openWs]);

  /** 接続情報（comment_server_url / jwt）を取り、WS 接続を始める。失敗してもポーリングは動き続ける */
  const connectWs = useCallback(
    async (id: string) => {
      if (typeof WebSocket === "undefined") return;
      setWsState("connecting");
      setWsInfo(null);
      setWsGiftCount(0);
      setWsTopic(null);
      wsClosesRef.current = 0;
      wsReceivedAnyRef.current = false;
      wsDeliveringRef.current = false;
      wsGiveUpRef.current = false;
      wsJoinErrorsRef.current = [];
      wsNextRefRef.current = createRefCounter();
      wsLiveIdRef.current = id;
      try {
        const r = await fetch(`/api/platforms/whowatch/live/ws?liveId=${encodeURIComponent(id)}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as { url: string | null; jwt: string | null };
        // 実測（2026-09-25 診断 v2）: /socket ではなく /socket/websocket?vsn=2.0.0 が入口。Origin 制限なし
        const url = phoenixSocketUrl(d.url, d.jwt);
        if (!url) {
          setWsState("failed");
          setWsInfo("この配信にはコメントサーバの URL が無いため、ポーリングだけで動いています");
          return;
        }
        wsJwtRef.current = d.jwt;
        wsCandidatesRef.current = [url];
        // 参加の組み合わせは実機で確定させる。確定したら localStorage の tagdeck.live.wsJoin
        // （JSON: {"topic":"live:lobby","payload":{...}}。値の "{id}" は live_id、"{jwt}" は jwt に置換）で先頭に差し込める
        let joins = joinCandidates(id, d.jwt);
        try {
          const override = localStorage.getItem("tagdeck.live.wsJoin");
          if (override) {
            const o = JSON.parse(override) as { topic?: string; payload?: Record<string, unknown> };
            if (o.topic) {
              const payload = Object.fromEntries(Object.entries(o.payload ?? {}).map(([k, v]) => [k, v === "{id}" ? id : v === "{jwt}" ? d.jwt : v]));
              joins = [{ topic: o.topic.replace("{id}", id), payload, label: `${o.topic.replace("{id}", id)}{手動}` }, ...joins];
            }
          }
        } catch {
          // localStorage が使えない・JSON が壊れている場合は候補のまま
        }
        wsJoinsRef.current = joins;
        if (!runningRef.current) return; // 取得中に停止された
        openWs();
      } catch (e) {
        if (!runningRef.current) return; // 取得中に停止された
        setWsState("failed");
        setWsInfo(`接続情報を取得できませんでした（ポーリングで続行）: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [openWs],
  );

  const start = useCallback(async () => {
    setStatus("checking");
    setMessage(null);
    readOnlyRef.current = false;
    setViewingOther(null);
    setSelfByTypedId(false);
    await unlockAudio().then(setAudioReady);
    try {
      const target = targetId.trim();
      // 対策D: パターンマスタは接続時に一度だけ取得（ライブ状態確認と並行）。
      // マスタは補助なので、回線瞬断で fetch が reject しても接続自体は止めない
      const [r, patternsRes] = await Promise.all([
        fetch(`/api/platforms/whowatch/live${target ? `?userId=${encodeURIComponent(target)}` : ""}`),
        fetch("/api/platforms/whowatch/items/patterns").catch(() => null),
      ]);
      const d = (await r.json()) as { found?: boolean; isLive: boolean; liveId: string | null; title?: string | null; displayName?: string | null; isOther?: boolean; error?: string };
      if (!r.ok) {
        setStatus(r.status === 404 ? "notfound" : "error");
        setMessage(d.error ?? "配信状態を取得できませんでした");
        void patternsRes?.body?.cancel();
        dispatchAutoConnect({ type: "disconnected", now: Date.now() });
        return;
      }
      if (!d.isLive || !d.liveId) {
        setStatus("offline");
        setMessage(d.displayName ? `${d.displayName}さんは現在配信していません` : "現在配信していません（配信開始後に「接続」を押してください）");
        void patternsRes?.body?.cancel();
        dispatchAutoConnect({ type: "disconnected", now: Date.now() });
        return;
      }
      const pd = patternsRes?.ok ? ((await patternsRes.json()) as ItemsPatternsResponse) : null;
      masterFetchedAtRef.current = Date.now();
      recordMasterResult(applyPatternMaster(pd));
      readOnlyRef.current = Boolean(d.isOther);
      setViewingOther(d.isOther ? (d.displayName ?? target) : null);
      setSelfByTypedId(target !== "" && !d.isOther);
      setLiveId(d.liveId);
      setTitle(d.title ?? null);
      lastUpdatedRef.current = 0;
      firstPollRef.current = true;
      lastGiftAtRef.current = null;
      setLastGiftAt(null);
      runningRef.current = true;
      setStatus("polling");
      startKeepAlive();
      dispatchAutoConnect({ type: "connected" });
      const loop = async () => {
        if (!runningRef.current) return;
        const startedAt = Date.now();
        try {
          if (!inFlightRef.current) {
            inFlightRef.current = true;
            try {
              const keepGoing = await pollOnce(d.liveId!);
              if (!keepGoing) {
                stop();
                return;
              }
            } finally {
              inFlightRef.current = false;
            }
          }
        } catch (e) {
          setMessage(`取得エラー: ${e instanceof Error ? e.message : String(e)}（再試行します）`);
        }
        // 固定レート: 取得にかかった時間を差し引いて次を予約する
        if (runningRef.current) timerRef.current = setTimeout(loop, nextPollDelay(pollIntervalFor({ isOther: readOnlyRef.current, serverIntervalMs: pollingIntervalRef.current, lastGiftAt: lastGiftAtRef.current, now: Date.now(), wsDelivering: wsDeliveringRef.current }), Date.now() - startedAt));
      };
      void loop();
      // WS 経路はポーリングと並行して開く（失敗してもポーリングだけで従来どおり動く）。
      // 決裁(2026-09-25 更新): 本人の配信に加え、閲覧中の他人の配信も即時経路を開く。
      // 受信のみ（phx_join / heartbeat だけ送信）で、他人の配信は元々 DB へ保存しない（readOnly）ため記録は増えない。
      // WS 経由のギフトは画面表示と SE のみに使い、保存はポーリング側（readOnly なら dryRun）に一任する
      void connectWs(d.liveId);
    } catch (e) {
      setStatus("error");
      setMessage(String(e));
      dispatchAutoConnect({ type: "disconnected", now: Date.now() });
    }
  }, [applyPatternMaster, connectWs, recordMasterResult, pollOnce, stop, targetId]);

  // ── 自動接続の待機ポーリング ─────────────────────────────────────────────
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const checkWaitingRef = useRef<() => void>(() => {});
  const checkWaiting = useCallback(() => {
    if (autoConnectRef.current.phase !== "waiting") return;
    // 他人の配信を一時的に見る指定があるときは自動接続の対象外（自分の配信開始を待つ機能のため）
    if (targetId.trim()) {
      idleTimerRef.current = setTimeout(() => checkWaitingRef.current(), idlePollInterval(0));
      return;
    }
    void (async () => {
      try {
        const r = await fetch("/api/platforms/whowatch/live");
        const d = (await r.json()) as { isLive?: boolean; liveId?: string | null };
        if (r.ok && d.isLive && d.liveId) {
          dispatchAutoConnect({ type: "live_detected" });
          void startRef.current();
          return;
        }
      } catch {
        // 取得に失敗しても待機は続ける
      }
      const cur = autoConnectRef.current;
      if (cur.phase !== "waiting") return;
      const waitedMs = Date.now() - (cur.waitingStartedAt ?? Date.now());
      idleTimerRef.current = setTimeout(() => checkWaitingRef.current(), idlePollInterval(waitedMs));
    })();
  }, [targetId]);
  useEffect(() => {
    checkWaitingRef.current = checkWaiting;
  }, [checkWaiting]);

  useEffect(() => {
    if (autoConnect.phase !== "waiting") return;
    checkWaiting();
    // 待機中もタブのタイマー間引きを防ぐ。ただし音が有効なときだけ（未解除で鳴らすことはできない）
    const c = getAudioContext();
    if (c?.state === "running") startKeepAlive();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
      // 接続へ進む場合は start() 側が鳴らし直すので、ここで止めても問題ない
      if (!runningRef.current) stopKeepAlive();
    };
    // checkWaiting は targetId で作り直されるが、待機の開始/終了は phase だけで判断する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect.phase]);

  // 縮退中は諦めずに取り直す。間隔は 5→15→45→120→300 秒（上限）で、回数の上限は設けない
  useEffect(() => {
    if (master.ready || master.nextRetryAt === null) return;
    const delay = Math.max(0, master.nextRetryAt - Date.now());
    const t = setTimeout(() => void fetchMaster(), delay);
    return () => clearTimeout(t);
  }, [master, fetchMaster]);

  const setAutoConnect = useCallback((on: boolean) => {
    dispatchAutoConnect(on ? { type: "enable", now: Date.now() } : { type: "disable" });
  }, []);

  const enableAudio = useCallback(async () => {
    const ok = await unlockAudio();
    setAudioReady(ok);
    // 待機中なら、音が有効になった時点で keepAlive を鳴らし始める
    if (ok && autoConnectRef.current.phase === "waiting") startKeepAlive();
  }, []);

  const pushTestGift = useCallback((g: Gift) => {
    setGifts((prev) => [g, ...prev].slice(0, 100));
  }, []);

  // レイアウトが外れるとき（ダッシュボードを離れるとき）だけ止める。
  // ページ間の移動では Provider は生き続けるので接続は切れない
  useEffect(() => () => stop(), [stop]);

  const value = useMemo<LiveConnectionValue>(
    () => ({
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
      mappings,
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
      autoConnectPhase: autoConnect.phase,
      setAutoConnect,
      start,
      stop,
      playGift,
      pushTestGift,
      setDebug,
      debug,
    }),
    [status, liveId, title, message, gifts, rawLog, autoPlay, volume, audioReady, enableAudio, pollingInterval, lastPolledAt, mappings, targetId, viewingOther, selfByTypedId, masterWarning, master, masterFilledCount, masterPatternCount, masterRecovered, serverBuildId, lastGiftAt, pollLog, giftLog, wsState, wsGiftCount, wsInfo, wsTopic, wsLog, autoConnect.phase, setAutoConnect, start, stop, playGift, pushTestGift, debug],
  );

  return <LiveConnectionContext.Provider value={value}>{children}</LiveConnectionContext.Provider>;
}
