// ふわっちの公開プロフィール（GET /users/{path}/profile・認証なし・読み取り専用）。
// 2026-10-07 実測: 応答に user_id（数値）・user_path（w:/t:）・name・gender（"男性" / "女性" / "未設定"）・publish_grade_name（ゴールド+ など）・
// live_history_count が入る。prefix 無しの ID（例: kuroppi1022）は `/users/kuroppi1022/profile` だと user_id が null の空応答になるので、
// user-path.ts の候補（w: → t:）を順に試す。
//
// 用途: N-1 グランプリの部門（男性 / 女性）の自動判定（社長報告「N-1 の部門が自動判定のままで入らない」= 本人が上位 100 名に居ないと
// 順位表から判定できない）と、/rankings 系の publisher_id（数値 ID）に渡して圏外でも本人の順位を得ること。
// サーバ専用（UA・origin ヘッダを持つ）。ブラウザから import しない。

import { resolveWhowatchDeviceId } from "../platforms/whowatch";
import { normalizeWhowatchUserPath } from "./user-path";

const BASE_URL = "https://api.whowatch.tv";
const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";
const TIMEOUT_MS = 10_000;
/** 同一プロセス内のキャッシュ（Workers では isolate 単位）。5 分同期が毎回叩かないため */
export const PROFILE_CACHE_TTL_MS = 10 * 60 * 1000;

export type ProfileGender = "male" | "female";

export interface PublicProfile {
  /** 数値 ID（publisher_id に渡す） */
  userId: string;
  /** w:xxx / t:xxx */
  userPath: string | null;
  name: string | null;
  /** プロフィールの性別。"未設定" やその他は null */
  gender: ProfileGender | null;
  /** 配信者グレード名（ゴールド+ など） */
  publishGradeName: string | null;
  liveHistoryCount: number | null;
}

export class WhowatchProfileApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "WhowatchProfileApiError";
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

/** 性別の表記 → male / female。"未設定"・空・それ以外は null */
export function genderFromLabel(v: unknown): ProfileGender | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "男性" || s.toLowerCase() === "male") return "male";
  if (s === "女性" || s.toLowerCase() === "female") return "female";
  return null;
}

/** 応答を正規化する。error_code 付き・user_id の無い空応答（prefix 違いの ID）は null */
export function normalizePublicProfile(raw: unknown): PublicProfile | null {
  const p = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!p || ("error_code" in p && p.error_code)) return null;
  const id = p.user_id;
  const userId = typeof id === "number" && id > 0 ? String(id) : typeof id === "string" && /^\d+$/.test(id) ? id : null;
  if (!userId) return null;
  return {
    userId,
    userPath: typeof p.user_path === "string" && p.user_path ? p.user_path : null,
    name: typeof p.name === "string" && p.name ? p.name : null,
    gender: genderFromLabel(p.gender),
    publishGradeName: typeof p.publish_grade_name === "string" && p.publish_grade_name ? p.publish_grade_name : null,
    liveHistoryCount: typeof p.live_history_count === "number" ? p.live_history_count : null,
  };
}

type CacheEntry = { at: number; value: PublicProfile | null };
const cache = new Map<string, CacheEntry>();

/** テスト用 */
export function clearPublicProfileCache(): void {
  cache.clear();
}

/**
 * 設定の「ふわっち ID」（prefix 無し・w:/t:・数値・URL）から公開プロフィールを取る。候補を順に試し、どれも空なら null（ID 間違い）。
 * HTTP エラーは例外（呼び出し側で握る）。結果は 10 分キャッシュ（見つからなかった結果も）
 */
export async function getPublicProfile(whowatchUserId: string): Promise<PublicProfile | null> {
  const key = (whowatchUserId ?? "").trim();
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PROFILE_CACHE_TTL_MS) return hit.value;
  let value: PublicProfile | null = null;
  for (const path of normalizeWhowatchUserPath(key).candidates) {
    const res = await fetch(`${BASE_URL}/users/${encodeURIComponent(path)}/profile`, { headers: headers(), signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new WhowatchProfileApiError(res.status, `whowatch profile ${path} → HTTP ${res.status}`);
    value = normalizePublicProfile(await res.json());
    if (value) break;
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}
