// ライブコックピットの WebSocket 経路（純関数。画面から切り離してテストする）。
//
// 決裁(2026-09-25): SE のラグはポーリング間隔そのもの（静かな時 10 秒）で、ポーリングを続ける限り
// ゼロにはならない。社長の決裁で /lives/{id} 応答の comment_server_url（ふわっちの Web 版が使う
// コメントサーバ）へブラウザから直接接続し、ギフトを即時に受け取る経路を追加した。
// ポーリングは止めない（保存の経路であり、WS が切れた時の予備経路でもある）。
//
// メッセージの形式は未確認（このリポジトリに実測が無い）。そのため
//   - 受信した生メッセージは ?debug=1 の学習モードでそのまま画面に出す（生ログ収集）
//   - 解析は「コメントらしい形（comment_type と id を持つオブジェクト）を、入れ子の中まで探す」
//     という防御的なやり方にし、形が違っても落ちない・鳴らないだけにする
// 形が確定したら extractComments() を狭めること。

import type { GiftCommentInput } from "../whowatch/gift-normalize";

/** 入れ子を探す深さの上限。無限ループや巨大メッセージでの CPU 消費を防ぐ */
const MAX_DEPTH = 4;
/** 1 メッセージから拾うコメント数の上限（異常な巨大配列対策） */
const MAX_COMMENTS = 200;

/** 再接続の待ち時間（ミリ秒）。1→2→4→8→16→30 秒で頭打ち */
export const WS_RECONNECT_BASE_MS = 1_000;
export const WS_RECONNECT_MAX_MS = 30_000;
/** 一度もメッセージを受け取れないまま連続で失敗したらこの回数で諦める（ポーリングは続く） */
export const WS_MAX_FAILURES_BEFORE_GIVE_UP = 5;

export type WsState = "off" | "connecting" | "open" | "reconnecting" | "failed";

/**
 * 接続先の候補。認証方式が未確認なので、まず comment_server_url をそのまま、
 * 次に jwt をクエリで付けた URL を試す（どちらで通るかは実測で確定する）。
 * jwt が既に URL に含まれている場合や無い場合は 1 候補だけ返す。
 */
export function wsUrlCandidates(url: string | null | undefined, jwt: string | null | undefined): string[] {
  if (!url || !/^wss?:\/\//i.test(url)) return [];
  const out = [url];
  if (jwt && !url.includes(jwt)) {
    try {
      const u = new URL(url);
      u.searchParams.set("jwt", jwt);
      out.push(u.toString());
    } catch {
      // URL として解釈できない場合は候補を増やさない
    }
  }
  return out;
}

/** 失敗回数から次の再接続までの待ち時間を決める（指数バックオフ） */
export function wsReconnectDelay(failures: number): number {
  const n = Math.max(0, Math.min(failures, 10));
  return Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * 2 ** n);
}

/** 受信データを JSON として読む。文字列でない・壊れている場合は null */
export function parseWsMessage(data: unknown): unknown {
  if (typeof data !== "string") return null;
  const s = data.trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** コメントらしい形か（/lives/{id} の comments[] と同じフィールドを持つ） */
export function looksLikeComment(v: unknown): v is GiftCommentInput & { comment_type: string } {
  if (!isRecord(v)) return false;
  const id = v.id;
  return typeof v.comment_type === "string" && (typeof id === "number" || typeof id === "string");
}

/**
 * メッセージの中からコメントらしいオブジェクトを全部拾う。
 * トップレベル・配列・入れ子（comment / comments / data / payload / body など、キー名は問わない）を
 * 深さ MAX_DEPTH まで探す。順序は出現順。
 */
export function extractComments(message: unknown): Array<GiftCommentInput & { comment_type: string }> {
  const out: Array<GiftCommentInput & { comment_type: string }> = [];
  const walk = (v: unknown, depth: number) => {
    if (out.length >= MAX_COMMENTS || depth > MAX_DEPTH) return;
    if (looksLikeComment(v)) {
      out.push(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (isRecord(v)) {
      for (const x of Object.values(v)) walk(x, depth + 1);
    }
  };
  walk(message, 0);
  return out;
}

/**
 * 接続直後に過去分がまとめて流れてきた場合に一斉に鳴るのを防ぐ。
 * posted_at（ミリ秒）が接続時刻より graceMs 以上前なら「過去分」とみなして鳴らさない（画面には出す）。
 * posted_at が無いものは判断できないので鳴らす側に倒す。
 */
export function isBacklogComment(postedAt: number | undefined, connectedAt: number, graceMs = 10_000): boolean {
  if (typeof postedAt !== "number") return false;
  return postedAt < connectedAt - graceMs;
}

/**
 * WebSocket の URL を、Workers の fetch() で握手できる http(s) の形に直す（wss→https, ws→http）。
 * サーバ側の診断（/live/ws/probe）で使う。ws(s) 以外は null
 */
export function wsUrlToHttp(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^wss:\/\//i.test(url)) return `https://${url.slice(6)}`;
  if (/^ws:\/\//i.test(url)) return `http://${url.slice(5)}`;
  return null;
}

/** 診断結果に秘密（jwt）が混ざらないよう伏せる。secret が空なら何もしない */
export function redactSecret(text: string, secret: string | null | undefined): string {
  if (!secret || secret.length < 8) return text;
  return text.split(secret).join("***");
}
