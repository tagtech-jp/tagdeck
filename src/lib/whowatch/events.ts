// ふわっち イベント／ランキング 公開 API クライアント（E1）
// 出典: docs/streaming/remote-studio-plan.md「イベント勝率シミュレーター用：ふわっち イベント／ランキング 公開API」
// 法務: 公開 REST のみ・読み取り専用・Origin/Referer をサーバ側で付与（ブラウザから直接叩かない）
//       エントリー・投稿・購入系（events/join_ranking, retire, settings 等）は呼ばない。

import { resolveWhowatchDeviceId } from "../platforms/whowatch"; // vitest は @/ エイリアス未設定のため相対パス

const BASE_URL = "https://api.whowatch.tv";
const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";
const TIMEOUT_MS = 10_000;
/** 10 分キャッシュ（同一プロセス内。Workers では isolate 単位） */
export const EVENT_CACHE_TTL_MS = 10 * 60 * 1000;
/** これ未満の期間はデイリー（0:00〜24:00 集計）とみなす */
export const DAILY_KIND_MAX_MS = 36 * 60 * 60 * 1000;

// ── 型 ─────────────────────────────────────────────────────────────────────

export type EventListStatus = "pre" | "open" | "closed";

export interface EventListItem {
  id: number;
  eventKey: string;
  bannerUrl: string;
  status: EventListStatus;
  badgeText: string | null;
  canEntry: boolean | null;
  participants: string | null;
  /** epoch ms（無い要素もある） */
  startedAt: number | null;
  endedAt: number | null;
}

export interface EventLists {
  pre: EventListItem[];
  open: EventListItem[];
  closed: EventListItem[];
}

export type EventTabType = "NOTIFICATION" | "RANKING" | "ITEM" | string;

export interface EventTab {
  title: string;
  type: EventTabType;
  detail: string;
}

export interface EventDetail {
  eventKey: string;
  name: string;
  shortName: string;
  tabs: EventTab[];
  /** RANKING タブの detail（無ければ null） */
  rankingPrefix: string | null;
  /** NOTIFICATION タブの detail 一覧（順序維持） */
  notificationIds: string[];
}

export interface RankingBorder {
  rank: number;
  color?: string;
}
export interface RankingChip {
  key: string;
  value: string;
}
export interface RankingTab {
  key: string;
  value?: string;
  chips?: RankingChip[];
  border?: RankingBorder[];
}
export interface RankingSelectbox {
  key: string;
  value?: string;
  border?: RankingBorder[];
  tabs?: RankingTab[];
}
export interface RankingOption {
  key: string;
  value?: string;
  selectboxes?: RankingSelectbox[];
}
/** /resources/json/rankings/{prefix} の応答。options 型か tabs 型のどちらか */
export interface RankingStruct {
  name?: string;
  options?: RankingOption[];
  tabs?: RankingTab[];
  [k: string]: unknown;
}

/** UI プルダウン用に平坦化した 1 選択肢 */
export interface RankingChoice {
  /** /rankings/{rankingType} にそのまま使うキー（prefix を含む） */
  rankingType: string;
  /** 「前半 › 前半総合」のような表示名 */
  label: string;
  /** キーの構成要素（prefix を除く） */
  parts: string[];
  /** 入賞ボーダー順位（無ければ空） */
  border: RankingBorder[];
}

export interface EventRules {
  id: string;
  title: string;
  html: string;
  text: string;
  eventKey: string | null;
  publishedAt: string | null;
}

// ── キャッシュ ───────────────────────────────────────────────────────────────

type CacheEntry<T> = { at: number; value: T };
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, loader: () => Promise<T>, ttl = EVENT_CACHE_TTL_MS): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await loader();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** テスト用 */
export function clearEventApiCache(): void {
  cache.clear();
}

// ── HTTP ───────────────────────────────────────────────────────────────────

export class WhowatchEventApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "WhowatchEventApiError";
  }
}

function headers(): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    origin: "https://whowatch.tv",
    referer: "https://whowatch.tv/",
    Accept: "application/json",
    "x-whowatch-device-id": resolveWhowatchDeviceId(),
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: headers(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new WhowatchEventApiError(res.status, `whowatch API ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ── 変換 ───────────────────────────────────────────────────────────────────

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeListItem(raw: unknown, status: EventListStatus): EventListItem | null {
  const e = (raw ?? {}) as Record<string, unknown>;
  if (e.id === null || e.id === undefined) return null;
  const badge = (e.badge ?? {}) as Record<string, unknown>;
  return {
    id: Number(e.id),
    eventKey: String(e.event_key ?? ""),
    bannerUrl: typeof e.banner === "string" ? e.banner : "",
    status,
    badgeText: badge.text != null ? String(badge.text) : null,
    canEntry: typeof e.can_entry === "boolean" ? e.can_entry : null,
    participants: e.text != null ? String(e.text) : null,
    startedAt: toNumberOrNull(e.started_at),
    endedAt: toNumberOrNull(e.ended_at),
  };
}

/** 'daily' | 'long' | null。ended_at - started_at < 36h をデイリーとみなす（絶対ルール3） */
export function computeEventKind(startedAtMs: number | null, endedAtMs: number | null): "daily" | "long" | null {
  if (!startedAtMs || !endedAtMs || endedAtMs <= startedAtMs) return null;
  return endedAtMs - startedAtMs < DAILY_KIND_MAX_MS ? "daily" : "long";
}

/** イベント終了 = ended_at(23:59:59 JST) + 1 秒 = 翌日 00:00:00 JST（絶対ルール3） */
export function endTimeFromEndedAt(endedAtMs: number): Date {
  return new Date(endedAtMs + 1000);
}

/** ランキング API のキー連結（"_" 区切り。例: autumncollection_1st_overall） */
export function buildRankingType(prefix: string, parts: string[]): string {
  return [prefix, ...parts].filter((p) => p && p.length > 0).join("_");
}

/**
 * 構造 JSON を UI プルダウン用に平坦化する。
 *  options[] → selectboxes[] → (tabs[] → chips[])  または  tabs[] → chips[]
 *  末端（chips が無い selectbox / chips 自体）が 1 選択肢。
 */
export function flattenRankingChoices(prefix: string, struct: RankingStruct | null | undefined): RankingChoice[] {
  const out: RankingChoice[] = [];
  if (!struct) return out;

  const pushLeaf = (parts: string[], labels: string[], border: RankingBorder[] | undefined) => {
    out.push({
      rankingType: buildRankingType(prefix, parts),
      label: labels.filter(Boolean).join(" › "),
      parts,
      border: border ?? [],
    });
  };

  const walkTabs = (tabs: RankingTab[] | undefined, parts: string[], labels: string[], inheritedBorder?: RankingBorder[]) => {
    for (const tab of tabs ?? []) {
      const tParts = [...parts, tab.key];
      const tLabels = [...labels, tab.value ?? tab.key];
      const border = tab.border ?? inheritedBorder;
      if (tab.chips && tab.chips.length > 0) {
        for (const chip of tab.chips) pushLeaf([...tParts, chip.key], [...tLabels, chip.value ?? chip.key], border);
      } else {
        pushLeaf(tParts, tLabels, border);
      }
    }
  };

  if (Array.isArray(struct.options) && struct.options.length > 0) {
    for (const opt of struct.options) {
      const oParts = [opt.key];
      const oLabels = [opt.value ?? opt.key];
      for (const sb of opt.selectboxes ?? []) {
        const sParts = [...oParts, sb.key];
        const sLabels = [...oLabels, sb.value ?? sb.key];
        if (sb.tabs && sb.tabs.length > 0) walkTabs(sb.tabs, sParts, sLabels, sb.border);
        else pushLeaf(sParts, sLabels, sb.border);
      }
    }
  } else if (Array.isArray(struct.tabs)) {
    walkTabs(struct.tabs, [], []);
  }
  return out;
}

/** 通知 body(HTML) を読めるテキストにする（style/script 除去・改行保持・実体参照復元） */
export function htmlToText(html: string): string {
  let s = html ?? "";
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote|section)>/gi, "\n");
  s = s.replace(/<\/(td|th)>/gi, "\t");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
  s = s
    .split("\n")
    .map((l) => l.replace(/[ \t　]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

// ── API ────────────────────────────────────────────────────────────────────

/** GET /event_lists → pre/open/closed */
export async function getEventLists(): Promise<EventLists> {
  return cached("event_lists", async () => {
    const data = await getJson<Record<string, unknown>>("/event_lists");
    const pick = (status: EventListStatus): EventListItem[] => {
      const list = data[status];
      if (!Array.isArray(list)) return [];
      return list.map((r) => normalizeListItem(r, status)).filter((x): x is EventListItem => x !== null);
    };
    return { pre: pick("pre"), open: pick("open"), closed: pick("closed") };
  });
}

/** GET /event_lists/{event_key} → 名前・タブ（RANKING の detail がランキング prefix） */
export async function getEventDetail(eventKey: string): Promise<EventDetail> {
  const key = encodeURIComponent(eventKey);
  return cached(`event_detail:${eventKey}`, async () => {
    const d = await getJson<Record<string, unknown>>(`/event_lists/${key}`);
    const tabsRaw = Array.isArray(d.tabs) ? (d.tabs as Record<string, unknown>[]) : [];
    const tabs: EventTab[] = tabsRaw.map((t) => ({
      title: String(t.title ?? ""),
      type: String(t.type ?? ""),
      detail: String(t.detail ?? ""),
    }));
    const ranking = tabs.find((t) => t.type === "RANKING" && t.detail);
    return {
      eventKey: String(d.event_key ?? eventKey),
      name: String(d.name ?? ""),
      shortName: String(d.short_name ?? d.name ?? ""),
      tabs,
      rankingPrefix: ranking ? ranking.detail : null,
      notificationIds: tabs.filter((t) => t.type === "NOTIFICATION" && t.detail).map((t) => t.detail),
    };
  });
}

/** GET /resources/json/rankings/{prefix} → 区分構造（そのまま） */
export async function getRankingStruct(prefix: string): Promise<RankingStruct> {
  return cached(`ranking_struct:${prefix}`, () => getJson<RankingStruct>(`/resources/json/rankings/${encodeURIComponent(prefix)}`));
}

/** GET /users/me/notifications/{id} → ルール本文（HTML と text）。認証なしで取得できることを 2026-09-20 に確認 */
export async function getRules(detailId: string): Promise<EventRules> {
  return cached(`rules:${detailId}`, async () => {
    const n = await getJson<Record<string, unknown>>(`/users/me/notifications/${encodeURIComponent(detailId)}`);
    const html = typeof n.body === "string" ? n.body : "";
    return {
      id: String(n.id ?? detailId),
      title: String(n.title ?? ""),
      html,
      text: htmlToText(html),
      eventKey: n.event_key != null ? String(n.event_key) : null,
      publishedAt: n.published_at != null ? String(n.published_at) : null,
    };
  });
}
