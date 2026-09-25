"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getAudioContext, playSe, startKeepAlive, stopKeepAlive, unlockAudio } from "@/lib/se/engine";
import { createSeQueue } from "@/lib/se/queue";
import { resolveMappingKey, tierForGift, type SeTier } from "@/lib/se/tiers";
import { nextPollDelay, partitionFreshGifts, pollIntervalFor } from "@/lib/live/polling";
import { idlePollInterval, INITIAL_AUTO_CONNECT_STATE, reduceAutoConnect, type AutoConnectPhase } from "@/lib/live/auto-connect";
import { INITIAL_MASTER_STATE, masterFailed, masterSucceeded, retryCountdownSec, type MasterState } from "@/lib/live/master-retry";
import { normalizeGift, type NormalizedGift as Gift, type PatternInfo, type PickedGiftComment } from "@/lib/whowatch/gift-normalize";
import type { ItemKind } from "@/lib/se/item-kind";

// ライブ接続の状態をアプリ全体で保持する Provider。
// (dashboard)/layout.tsx に置いてあるため、ページを移動しても接続と SE 再生が続く。
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
}
export interface GiftSample {
  at: number;
  label: string;
  patternId: number | null;
  patternName: string | null;
  kind: ItemKind | null;
  arrivalMs: number | null;
  totalMs: number | null;
  rawTotalMs: number | null;
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
  /** 自動接続の状態。off 以外はチェックボックスが ON */
  autoConnectPhase: AutoConnectPhase;
  setAutoConnect: (on: boolean) => void;
  start: () => Promise<void>;
  stop: () => void;
  playGift: (g: Pick<Gift, "pattern_id" | "item_id" | "price_yen" | "count" | "is_hit" | "kind"> & { groups?: string[] }, forceTier?: SeTier) => Promise<void>;
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

  const playGift = useCallback(async (g: Pick<Gift, "pattern_id" | "item_id" | "price_yen" | "count" | "is_hit" | "kind"> & { groups?: string[] }, forceTier?: SeTier) => {
    const tier = forceTier ?? tierForGift({ priceYen: g.price_yen, count: g.count, isHit: g.is_hit });
    const target = { patternId: g.pattern_id, itemId: g.item_id, tier, kind: g.kind, groups: g.groups };
    const enabledKeys = new Set(mappingsRef.current.filter((m) => m.enabled).map((m) => m.key));
    const disabledKeys = new Set(mappingsRef.current.filter((m) => !m.enabled).map((m) => m.key));
    const key = resolveMappingKey(enabledKeys, target);
    if (!key && resolveMappingKey(disabledKeys, target)) return; // 明示的に無効化
    const m = key ? mappingsRef.current.find((x) => x.key === key) : undefined;
    const vol = (volumeRef.current / 100) * ((m?.volume ?? 80) / 100);
    await playSe(tier, { url: m?.url ?? null, volume: vol });
  }, []);

  const playQueued = useCallback(
    async (q: QueuedGift) => {
      const playedAt = Date.now();
      // 当たり判定はパターン名からの推定。実ログで精度を確かめられるよう残す
      if (q.gift.is_hit) console.info("[tagdeck] 当たり検知", { pattern_id: q.gift.pattern_id, pattern_name: q.gift.pattern_name, item_name: q.gift.item_name, hit_grade: q.gift.hit_grade, posted_at: q.gift.posted_at });
      await playGift(q.gift);
      if (!debugRef.current) return;
      const postedAt = q.gift.posted_at ? Date.parse(q.gift.posted_at) : null;
      setGiftLog((prev) =>
        [
          {
            at: playedAt,
            label: `${q.gift.item_name ?? `不明なアイテム（#${q.gift.pattern_id ?? "?"}）`}${q.gift.count > 1 ? ` ×${q.gift.count}` : ""}`,
            patternId: q.gift.pattern_id,
            patternName: q.gift.pattern_name,
            kind: q.gift.kind,
            arrivalMs: postedAt !== null && q.skewMs !== null ? q.receivedAt + q.skewMs - postedAt : null,
            totalMs: postedAt !== null && q.skewMs !== null ? playedAt + q.skewMs - postedAt : null,
            rawTotalMs: postedAt !== null ? playedAt - postedAt : null,
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

  const stop = useCallback(() => {
    runningRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    seQueueRef.current.clear();
    stopKeepAlive();
    setStatus("idle");
    // 自動接続が ON なら待機へ戻る（OFF ならそのまま止まる）
    dispatchAutoConnect({ type: "disconnected", now: Date.now() });
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
      const normalized = d.giftComments.map((c) =>
        normalizeGift(c, (pid) => {
          const info = patternLookupRef.current.get(pid);
          if (!info) {
            missingPattern = true;
            // 縮退中は次のポーリングでサーバに照合してもらう
            if (!masterRef.current.ready) askedPatternsRef.current.add(pid);
          }
          return info ?? null;
        }),
      );
      void refetchMasterIfStale(missingPattern);
      const { fresh, toPlay } = partitionFreshGifts(normalized, seenRef.current, firstPollRef.current);
      firstPollRef.current = false;
      for (const g of fresh) seenRef.current.add(g.comment_id);
      if (dbg) {
        const colo = res.headers.get("cf-ray")?.split("-")[1] ?? null;
        setPollLog((prev) => [{ at: startedAt, gapMs, rttMs: receivedAt - startedAt, server: d.timings ?? null, hidden, colo, gifts: fresh.length, deferredSave: d.deferredSave }, ...prev].slice(0, 60));
      }
      if (fresh.length > 0) {
        // 対策F: ギフトが来た＝盛り上がっている。ここから一定時間は間隔を詰める
        lastGiftAtRef.current = receivedAt;
        setLastGiftAt(receivedAt);
        setGifts((prev) => [...fresh.slice().reverse(), ...prev].slice(0, 100));
        // 一斉に鳴らすと同じ音が同位相で重なって 1 件に聞こえるため、キューで順番に鳴らす
        if (autoPlayRef.current) seQueueRef.current.push(toPlay.map((gift) => ({ gift, receivedAt, skewMs })));
      }
      if (d.liveStatus && d.liveStatus !== "PUBLISHING") {
        setMessage(`配信が終了しました（${d.liveStatus}）`);
        return false;
      }
      return true;
    },
    [refetchMasterIfStale],
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
        if (runningRef.current) timerRef.current = setTimeout(loop, nextPollDelay(pollIntervalFor({ isOther: readOnlyRef.current, serverIntervalMs: pollingIntervalRef.current, lastGiftAt: lastGiftAtRef.current, now: Date.now() }), Date.now() - startedAt));
      };
      void loop();
    } catch (e) {
      setStatus("error");
      setMessage(String(e));
      dispatchAutoConnect({ type: "disconnected", now: Date.now() });
    }
  }, [applyPatternMaster, recordMasterResult, pollOnce, stop, targetId]);

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
      autoConnectPhase: autoConnect.phase,
      setAutoConnect,
      start,
      stop,
      playGift,
      pushTestGift,
      setDebug,
      debug,
    }),
    [status, liveId, title, message, gifts, rawLog, autoPlay, volume, audioReady, enableAudio, pollingInterval, lastPolledAt, mappings, targetId, viewingOther, selfByTypedId, masterWarning, master, masterFilledCount, masterPatternCount, masterRecovered, serverBuildId, lastGiftAt, pollLog, giftLog, autoConnect.phase, setAutoConnect, start, stop, playGift, pushTestGift, debug],
  );

  return <LiveConnectionContext.Provider value={value}>{children}</LiveConnectionContext.Provider>;
}
