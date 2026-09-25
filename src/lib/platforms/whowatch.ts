// ふわっち公式 REST API クライアント（5 秒ポーリング専用）
// フィールド名は api.whowatch.tv の実レスポンスに準拠

const BASE_URL = "https://api.whowatch.tv";
const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";
const DEFAULT_DEVICE_SEED = "tagdeck-whowatch-monitor";

export type WhowatchLive = {
  live_id?: string;
  id?: string | number;
  title: string;
  view_num?: number;
  view_count?: number;
  total_view_count?: number;
  total_point?: number;
  // (要確認) item_count・comment_countはUI表示には使用しない（下記コメント参照）。
  // 型としては実レスポンスに存在するため残しているが、実配信での実測により信頼性が確認できていない。
  item_count?: number;
  comment_count?: number;
  nice_info?: { total_count?: number };
  live_started_at?: number;
  started_at?: number;
  user?: {
    id?: string | number;
    name?: string;
    user_path?: string;
    account_name?: string;
  };
};

type LivesHistoryResponse = {
  lives: WhowatchLive[];
};

type LiveDetailResponse = {
  live: WhowatchLive | null;
};

export type WhowatchStreamerState = {
  liveId: string | null;
  liveUrl: string | null;
  viewerCount: number;
  currentPoints: number;
  peakViewerCount: number;
  isLive: boolean;
  // 2026-07-24 実機再検証で comment_count / item_count は表示から除外（下記コメント参照）
  totalViewCount: number;
  niceCount: number;
};

function hashDeviceSeed(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function resolveWhowatchDeviceId(seed = DEFAULT_DEVICE_SEED): string {
  const configured = process.env.WHOWATCH_DEVICE_ID?.trim();
  if (configured) return configured;

  const normalizedSeed = seed.trim() || DEFAULT_DEVICE_SEED;
  return `tagdeck-auto-${hashDeviceSeed(normalizedSeed)}`;
}

export function buildWhowatchLiveUrl(liveId: string | null | undefined): string | null {
  if (!liveId) return null;
  return `https://whowatch.tv/${encodeURIComponent(liveId)}`;
}

function buildWhowatchHeaders(deviceSeed?: string): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    origin: "https://whowatch.tv",
    referer: "https://whowatch.tv/",
    "x-whowatch-device-id": resolveWhowatchDeviceId(deviceSeed),
  };
}

function normalizeWhowatchIdentifier(value: string | number | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^@/, "")
    .replace(/^(?:t|w|ふ):/i, "")
    .toLowerCase();
}

function resolveWhowatchLiveId(live: WhowatchLive): string | null {
  return String(live.live_id ?? live.id ?? "").trim() || null;
}

function resolveWhowatchViewerCount(live: WhowatchLive): number {
  return Number(live.view_num ?? live.view_count ?? 0);
}

// 2026-07-24 追加検証: 実機capture(REAL_LIVE_DETAILフィクスチャ)で total_point 欠落・
// item_count のみ存在するケースを確認。item_countは信頼性未確認(上記コメント参照)のため
// フォールバックに使うと表示が汚染される。total_point欠落時は0とする。
function resolveWhowatchPointCount(live: WhowatchLive): number {
  return Number(live.total_point ?? 0);
}

// comment_count / item_count は2026-07-24の実機再検証（3サンプル・うち1件は社長の公式画面実測値との
// 突合）で以下が判明したため、UI表示には使用しない:
//   - comment_count: アクティブなチャットが多数あるライブでも常に 0 のまま25秒間変化せず、
//     公式画面の実コメント数（124件）とも大きく乖離。信頼できるコメント数ソースではない。
//   - item_count: 公式画面の実ポイント値（109pt）と一致せず、別の配信では視聴者数と偶然同値になる
//     ケースも確認。ポイント・アイテム個数のいずれかを正確に表しているという確証が取れなかった。
// 「不正確な数字は見せない」方針により、確定するまでバッジ表示から除外する（(要確認)）。

/** 累計視聴数（total_view_count）。時間経過で単調増加する信頼できる集計値。 */
function resolveWhowatchTotalViewCount(live: WhowatchLive): number {
  return Number(live.total_view_count ?? 0);
}

/** 「いいね」累計数。 */
function resolveWhowatchNiceCount(live: WhowatchLive): number {
  return Number(live.nice_info?.total_count ?? 0);
}

function matchesWhowatchUser(live: WhowatchLive, userId: string): boolean {
  const normalized = normalizeWhowatchIdentifier(userId);
  if (!normalized) return false;

  const candidates = [
    live.user?.id,
    live.user?.account_name,
    live.user?.user_path,
    live.user?.name,
  ].map(normalizeWhowatchIdentifier);

  return candidates.includes(normalized);
}

async function fetchJson<T>(url: string, deviceSeed?: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: buildWhowatchHeaders(deviceSeed),
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export async function fetchLatestLive(userId: string): Promise<WhowatchLive | null> {
  const liveList = await fetchJson<WhowatchLive[]>(
    `${BASE_URL}/lives2?category_id=152`,
    userId,
  );
  const live = liveList?.find((entry) => matchesWhowatchUser(entry, userId));
  if (live) return live;

  if (!/^\d+$/.test(userId)) return null;

  const data = await fetchJson<LivesHistoryResponse>(
    `${BASE_URL}/users/${userId}/lives_history?count=1`,
    userId,
  );
  return data?.lives?.[0] ?? null;
}

export async function fetchLiveDetail(liveId: string, deviceSeed?: string): Promise<WhowatchLive | null> {
  const data = await fetchJson<LiveDetailResponse>(`${BASE_URL}/lives/${liveId}`, deviceSeed);
  return data?.live ?? null;
}

function notLiveState(prevPeak: number): WhowatchStreamerState {
  return {
    liveId: null,
    liveUrl: null,
    viewerCount: 0,
    currentPoints: 0,
    peakViewerCount: prevPeak,
    isLive: false,
    totalViewCount: 0,
    niceCount: 0,
  };
}

export async function pollWhowatchStreamerState(
  userId: string,
  prevPeak = 0
): Promise<WhowatchStreamerState> {
  const latest = await fetchLatestLive(userId);
  if (!latest) {
    return notLiveState(prevPeak);
  }

  const latestLiveId = resolveWhowatchLiveId(latest);
  if (!latestLiveId) {
    return notLiveState(prevPeak);
  }

  const detail = await fetchLiveDetail(latestLiveId, userId);
  if (!detail) {
    return notLiveState(prevPeak);
  }

  const detailLiveId = resolveWhowatchLiveId(detail);
  const viewerCount = resolveWhowatchViewerCount(detail);
  const currentPoints = resolveWhowatchPointCount(detail);

  return {
    liveId: detailLiveId,
    liveUrl: buildWhowatchLiveUrl(detailLiveId),
    viewerCount,
    currentPoints,
    peakViewerCount: Math.max(prevPeak, viewerCount),
    isLive: true,
    totalViewCount: resolveWhowatchTotalViewCount(detail),
    niceCount: resolveWhowatchNiceCount(detail),
  };
}
