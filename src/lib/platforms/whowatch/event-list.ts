// ふわっちイベント一覧取得（DB 優先・スクレイパーは DB 失敗時のフォールバック）
// 利用規約条件: User-Agent 明示・device-id 環境変数経由・25 秒以上間隔

import { z } from "zod";

const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";
const TIMEOUT_MS = 10_000;

// robots.txt Disallow パスを含まない URL のみ（規約条件 2）
const WHOWATCH_ALLOWED_URLS = [
  "https://api.whowatch.tv/event_lists",
  "https://whowatch.tv/events",
] as const;

export const WhowatchEventsResultSchema = z.object({
  events: z.array(
    z.object({
      eventId: z.string(),
      name: z.string(),
      startAt: z.string(),
      endAt: z.string(),
      rankingUrl: z.string(),
      category: z.string().optional(),
    })
  ),
  source: z.enum(["api", "embedded", "manual"]),
});

export type WhowatchEventsResult = z.infer<typeof WhowatchEventsResultSchema>;

// ── DB 同期用の生イベント取得（whowatch_events スキーマ準拠） ──────────────
// started_at / ended_at は API 上エポックミリ秒。Date へ変換して返す。
export type WhowatchEventStatus = "pre" | "open" | "closed";

export interface WhowatchEventListItem {
  id: number;
  eventKey: string;
  bannerUrl: string;
  status: WhowatchEventStatus;
  badgeText: string | null;
  badgeColor: string | null;
  badgeAnimation: boolean;
  startedAt: Date | null;
  endedAt: Date | null;
  participants: string | null;
}

/** エポックミリ秒(number|string) を Date へ。0/null/不正値は null。 */
export function epochMsToDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const ms = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * event_lists API から pre/open/closed の全イベントを whowatch_events スキーマ形で取得する。
 * DB オンデマンド同期用。日本語名(title_ja)は含めない（events route が別途取得）。
 * device-id が空、または API 失敗時は空配列を返す（呼び出し側は既存 DB 値を維持）。
 */
export async function fetchWhowatchEventList(
  deviceId: string
): Promise<WhowatchEventListItem[]> {
  if (!deviceId) return [];

  let data: unknown;
  try {
    const res = await fetch(WHOWATCH_ALLOWED_URLS[0], {
      headers: {
        "User-Agent": USER_AGENT,
        "x-whowatch-device-id": deviceId,
        origin: "https://whowatch.tv",
        referer: "https://whowatch.tv/",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return [];
    data = await res.json();
  } catch {
    return [];
  }

  const buckets: WhowatchEventStatus[] = ["pre", "open", "closed"];
  const out: WhowatchEventListItem[] = [];
  const root = (data ?? {}) as Record<string, unknown>;

  for (const status of buckets) {
    const list = root[status];
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const e = (raw ?? {}) as Record<string, unknown>;
      if (e.id === null || e.id === undefined) continue;
      const badge = (e.badge ?? {}) as Record<string, unknown>;
      out.push({
        id: Number(e.id),
        eventKey: String(e.event_key ?? ""),
        bannerUrl: typeof e.banner === "string" ? e.banner : "",
        status,
        badgeText: badge.text != null ? String(badge.text) : null,
        badgeColor: badge.color != null ? String(badge.color) : null,
        badgeAnimation: Boolean(badge.animation),
        startedAt: epochMsToDate(e.started_at),
        endedAt: epochMsToDate(e.ended_at),
        participants: e.text != null ? String(e.text) : null,
      });
    }
  }
  return out;
}

export async function fetchWhowatchEvents(): Promise<WhowatchEventsResult> {
  const deviceId = process.env.WHOWATCH_DEVICE_ID ?? "";

  // 第一候補: REST API (api.whowatch.tv/event_lists)
  if (deviceId) {
    try {
      const res = await fetch(WHOWATCH_ALLOWED_URLS[0], {
        headers: {
          "User-Agent": USER_AGENT,
          "x-whowatch-device-id": deviceId,
          origin: "https://whowatch.tv",
          referer: "https://whowatch.tv/",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await res.json()) as any;
        const events = normalizeEventLists(data);
        if (events.length > 0) return { events, source: "api" };
      }
    } catch {
      // fall through to next candidate
    }
  }

  // 第二候補: whowatch.tv/events HTML の embedded-data JSON
  try {
    const res = await fetch(WHOWATCH_ALLOWED_URLS[1], {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) {
      const html = await res.text();
      const events = parseEmbeddedEvents(html);
      if (events.length > 0) return { events, source: "embedded" };
    }
  } catch {
    // fall through to manual
  }

  // 第三候補: フォールバック（フロント側でユーザーが URL を手動入力）
  return { events: [], source: "manual" };
}

// event_lists API レスポンス: { pre: [...], open: [...], closed: [...] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEventLists(data: any): WhowatchEventsResult["events"] {
  const all: WhowatchEventsResult["events"] = [];
  for (const status of ["open", "pre"] as const) {
    const list = data?.[status];
    if (!Array.isArray(list)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of list as any[]) {
      if (!e?.id) continue;
      all.push({
        eventId: String(e.id),
        name: String(e.event_key ?? e.name ?? ""),
        startAt: String(e.started_at ?? ""),
        endAt: String(e.ended_at ?? ""),
        rankingUrl: String(
          (e.banner as Record<string, unknown>)?.url ??
            `https://whowatch.tv/events/${e.id}`
        ),
        category: e.badge?.text ? String(e.badge.text) : undefined,
      });
    }
  }
  return all;
}

function parseEmbeddedEvents(html: string): WhowatchEventsResult["events"] {
  const match = html.match(/<script[^>]*id="embedded-data"[^>]*data-props="([^"]+)"/);
  if (!match) return [];
  try {
    const decoded = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    const data = JSON.parse(decoded) as Record<string, unknown>;
    const events =
      (data.events as unknown[] | undefined) ??
      (data.eventList as unknown[] | undefined) ??
      [];
    if (!Array.isArray(events)) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (events as any[])
      .filter((e) => e?.id && e?.name)
      .map((e) => ({
        eventId: String(e.id),
        name: String(e.name),
        startAt: String(e.start_at ?? ""),
        endAt: String(e.end_at ?? ""),
        rankingUrl: String(e.ranking_url ?? `https://whowatch.tv/events/${e.id}/rankings`),
        category: e.category ? String(e.category) : undefined,
      }));
  } catch {
    return [];
  }
}
