// ふわっち ランキング公開 API クライアント（E2）
// GET /rankings/{ranking_type}?limit=N&detail=true[&publisher_id=]
//   → [{title, status(1=開催中,3=終了), ranking_type, rankings:[{rank, point, total_view_count, user{id,user_path,name,icon_url}}]}]
// 読み取り専用。Origin/Referer はサーバ側で付与（ブラウザから直接叩かない）。

import { resolveWhowatchDeviceId } from "../platforms/whowatch";

const BASE_URL = "https://api.whowatch.tv";
const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";
const TIMEOUT_MS = 10_000;
export const RANKING_TYPE_RE = /^[a-z0-9_]{1,200}$/i;

export interface RankingEntryApi {
  rank: number;
  point: number;
  userId: string | null;
  userPath: string | null;
  name: string;
  totalViewCount: number | null;
}

export interface RankingResult {
  rankingType: string;
  title: string;
  /** 1=開催中, 3=終了（API 実測）。不明は null */
  status: number | null;
  entries: RankingEntryApi[];
  fetchedAt: string;
}

export class WhowatchRankingApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "WhowatchRankingApiError";
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

/** API 応答（配列）を正規化する。ranking_type が一致する要素を優先し、無ければ先頭 */
export function normalizeRankingResponse(data: unknown, rankingType: string): RankingResult | null {
  const list = Array.isArray(data) ? (data as Record<string, unknown>[]) : data && typeof data === "object" ? [data as Record<string, unknown>] : [];
  if (list.length === 0) return null;
  const wanted = rankingType.toLowerCase();
  const block = list.find((b) => String(b.ranking_type ?? "").toLowerCase() === wanted) ?? list[0];
  const raw = Array.isArray(block.rankings) ? (block.rankings as Record<string, unknown>[]) : [];
  const entries: RankingEntryApi[] = raw
    .map((r) => {
      const user = (r.user ?? {}) as Record<string, unknown>;
      return {
        rank: Number(r.rank ?? 0),
        point: Number(r.point ?? 0),
        userId: user.id != null ? String(user.id) : null,
        userPath: user.user_path != null ? String(user.user_path) : null,
        name: String(user.name ?? ""),
        totalViewCount: r.total_view_count != null ? Number(r.total_view_count) : null,
      };
    })
    .filter((e) => Number.isFinite(e.rank) && e.rank > 0)
    .sort((a, b) => a.rank - b.rank);
  return {
    rankingType: String(block.ranking_type ?? rankingType),
    title: String(block.title ?? ""),
    status: typeof block.status === "number" ? block.status : null,
    entries,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getRankings(
  rankingType: string,
  opts: { limit?: number; publisherId?: string | null } = {},
): Promise<RankingResult> {
  if (!RANKING_TYPE_RE.test(rankingType)) throw new WhowatchRankingApiError(400, `invalid ranking_type: ${rankingType}`);
  const params = new URLSearchParams({ limit: String(opts.limit ?? 100), detail: "true" });
  if (opts.publisherId) params.set("publisher_id", opts.publisherId);
  const url = `${BASE_URL}/rankings/${encodeURIComponent(rankingType)}?${params.toString()}`;
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new WhowatchRankingApiError(res.status, `whowatch rankings ${rankingType} → HTTP ${res.status}`);
  const data = await res.json();
  const normalized = normalizeRankingResponse(data, rankingType);
  if (!normalized) throw new WhowatchRankingApiError(502, "empty ranking response");
  return normalized;
}

// ── 自分の特定・ライバル選定 ─────────────────────────────────────────────────

function normId(v: string | null | undefined): string {
  return String(v ?? "")
    .trim()
    .replace(/^@/, "")
    .replace(/^(?:t|w|ふ):/i, "")
    .toLowerCase();
}

/**
 * ランキングから自分を探す。優先順: whowatchUserId(数値 id / user_path) → myEntryName(表示名・user_path)
 */
export function findMyEntry(
  entries: RankingEntryApi[],
  me: { whowatchUserId?: string | null; myEntryName?: string | null },
): RankingEntryApi | null {
  const uid = normId(me.whowatchUserId);
  if (uid) {
    const hit = entries.find((e) => normId(e.userId) === uid || normId(e.userPath) === uid);
    if (hit) return hit;
  }
  const name = (me.myEntryName ?? "").trim();
  if (name) {
    const hit = entries.find((e) => e.name === name || normId(e.userPath) === normId(name));
    if (hit) return hit;
  }
  return null;
}

/**
 * ライバル自動選定（仕様 E2）:
 *   目標順位の前後（targetRank-1, targetRank, targetRank+1）と、現在の自分の直上（myRank-1）。
 *   自分自身は除外し、順位順に重複なく返す。自分が未特定なら目標周辺のみ。
 */
export function selectAutoRivals(
  entries: RankingEntryApi[],
  targetRank: number,
  myEntry: RankingEntryApi | null,
): RankingEntryApi[] {
  const wanted = new Set<number>([targetRank - 1, targetRank, targetRank + 1].filter((r) => r >= 1));
  if (myEntry && myEntry.rank > 1) wanted.add(myEntry.rank - 1);
  const byRank = new Map(entries.map((e) => [e.rank, e]));
  const out: RankingEntryApi[] = [];
  for (const r of [...wanted].sort((a, b) => a - b)) {
    const e = byRank.get(r);
    if (!e) continue;
    if (myEntry && e.rank === myEntry.rank) continue;
    out.push(e);
  }
  return out;
}
