// S1: ふわっち配信コメントのポーリング取得（公開 REST のみ・読み取り専用）
//   live_id: GET /users/{path}/profile の live[0].id（配信中のみ存在。2026-09-20 実測）
//   本文  : GET /lives/{id}?last_updated_at=N&v5_nomask=true → comments[], updated_at, polling_interval(実測 10000ms)
//   BY_PLAYITEM を {comment_id, pattern_id, item_id, count, is_hit, user} に正規化する。
// AGENTS.md の法務制約どおり WebSocket は使わない。

import { resolveWhowatchDeviceId } from "../platforms/whowatch";
import type { LiveComment } from "./gift-normalize";

// ギフトの型と正規化は gift-normalize.ts（純関数・ブラウザからも import される）に置いてある。
// このファイルはサーバ専用（device-id・UA・origin ヘッダを持つ）なのでクライアントから import しないこと。
export * from "./gift-normalize";

const BASE_URL = "https://api.whowatch.tv";
const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";
const TIMEOUT_MS = 10_000;
/** 視聴者 1 人分の頻度。サーバ指定 polling_interval と 3 秒の大きい方 */
export const MIN_POLL_INTERVAL_MS = 3000;
export const DEFAULT_POLL_INTERVAL_MS = 10_000;

function headers(): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    origin: "https://whowatch.tv",
    referer: "https://whowatch.tv/",
    Accept: "application/json",
    "x-whowatch-device-id": resolveWhowatchDeviceId(),
  };
}

export class WhowatchLiveApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "WhowatchLiveApiError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new WhowatchLiveApiError(res.status, `whowatch API ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

// ── 型 ─────────────────────────────────────────────────────────────────────

export interface LiveResponse {
  live: Record<string, unknown> | null;
  comments: LiveComment[];
  updatedAt: number | null;
  pollingInterval: number;
  liveStatus: string | null;
  raw: Record<string, unknown>;
}

// ── API ────────────────────────────────────────────────────────────────────

/** profile 応答から配信中 live_id を取る（無ければ null = 非配信） */
export function liveIdFromProfile(profile: unknown): { liveId: string | null; title: string | null; startedAt: number | null } {
  const p = (profile ?? {}) as Record<string, unknown>;
  const live = p.live;
  const first = Array.isArray(live) ? (live[0] as Record<string, unknown> | undefined) : live && typeof live === "object" ? (live as Record<string, unknown>) : undefined;
  const id = first?.id;
  if (typeof id === "number" && id > 0) {
    return { liveId: String(id), title: typeof first?.title === "string" ? (first.title as string) : null, startedAt: typeof first?.started_at === "number" ? (first.started_at as number) : null };
  }
  if (typeof id === "string" && /^\d+$/.test(id)) return { liveId: id, title: typeof first?.title === "string" ? (first.title as string) : null, startedAt: null };
  return { liveId: null, title: null, startedAt: null };
}

/** URL が貼られた場合に ID 部分（prefix 付きも可）を取り出す。それ以外は入力のまま */
function stripProfileUrl(value: string): string {
  const m = /whowatch\.tv\/(?:profile\/)?([^/?#]+)/i.exec(value);
  if (!m) return value;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * 入力（ふわっちID・連携XのID・数値ID・プロフィールURL）を profile API のパス候補へ正規化する。
 * prefix が無い英数字はどちらの ID か判別できないため `w:` → `t:` の順に試す候補を返す。
 * ID 部分の大文字小文字は変換しない（`w:Thomas19981022` のように大文字始まりが実在する）。
 */
export function normalizeWhowatchUserPath(input: string): { path: string; candidates: string[] } {
  // 全角 ！(U+FF01) 〜 ～(U+FF5E) は対応する半角に直す（スマホからの貼り付け対策）
  const halfWidth = (input ?? "").replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const bare = stripProfileUrl(halfWidth.trim()).trim().replace(/^@/, "");

  const prefixed = /^(w|t|ふ):(.*)$/i.exec(bare);
  if (prefixed) {
    const id = prefixed[2];
    if (!id) return { path: "", candidates: [] };
    const prefix = prefixed[1] === "ふ" ? "w" : prefixed[1].toLowerCase();
    return single(`${prefix}:${id}`);
  }

  if (!bare) return { path: "", candidates: [] };
  if (/^\d+$/.test(bare)) return single(bare);
  return { path: `w:${bare}`, candidates: [`w:${bare}`, `t:${bare}`] };
}

function single(path: string): { path: string; candidates: string[] } {
  return { path, candidates: [path] };
}

/** ユーザー不在（U-002）等は HTTP 200 + error_code で返るため、本文を見ないと非配信と区別できない */
function errorCodeOf(profile: unknown): string | null {
  const code = (profile as Record<string, unknown> | null)?.error_code;
  return typeof code === "string" && code ? code : null;
}

export interface WhowatchLiveLookup {
  /** 候補のいずれかでユーザーが見つかったか。false = ID 間違い（非配信ではない） */
  found: boolean;
  liveId: string | null;
  title: string | null;
  startedAt: number | null;
  displayName: string | null;
  userPath: string | null;
}

export async function fetchLiveId(whowatchUserId: string): Promise<WhowatchLiveLookup> {
  for (const path of normalizeWhowatchUserPath(whowatchUserId).candidates) {
    const profile = await getJson<Record<string, unknown>>(`/users/${encodeURIComponent(path)}/profile`);
    if (errorCodeOf(profile)) continue;
    return {
      found: true,
      ...liveIdFromProfile(profile),
      displayName: typeof profile.name === "string" ? profile.name : null,
      userPath: typeof profile.user_path === "string" ? profile.user_path : path,
    };
  }
  return { found: false, liveId: null, title: null, startedAt: null, displayName: null, userPath: null };
}

export async function fetchLive(liveId: string, lastUpdatedAt: number | string = 0): Promise<LiveResponse> {
  const raw = await getJson<Record<string, unknown>>(`/lives/${encodeURIComponent(liveId)}?last_updated_at=${encodeURIComponent(String(lastUpdatedAt))}&v5_nomask=true`);
  const comments = Array.isArray(raw.comments) ? (raw.comments as LiveComment[]) : [];
  const live = raw.live && typeof raw.live === "object" ? (raw.live as Record<string, unknown>) : null;
  const pi = typeof raw.polling_interval === "number" ? raw.polling_interval : DEFAULT_POLL_INTERVAL_MS;
  // jwt は保存も返却もしない（秘密扱い）
  const { jwt: _jwt, ...rest } = raw;
  void _jwt;
  return {
    live,
    comments,
    updatedAt: typeof raw.updated_at === "number" ? raw.updated_at : null,
    pollingInterval: Math.max(MIN_POLL_INTERVAL_MS, pi),
    liveStatus: typeof live?.live_status === "string" ? (live.live_status as string) : null,
    raw: rest,
  };
}
