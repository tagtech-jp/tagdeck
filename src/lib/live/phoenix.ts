// Phoenix Channels（Elixir 製リアルタイム基盤）の配線形式（純関数）。
//
// 2026-09-25 実測（/live/ws/probe v2）: ふわっちのコメントサーバ comment_server_url = wss://ws.whowatch.tv/socket は
// /socket/websocket?vsn=2.0.0 で握手が通り（101）、Origin 制限は無い。Phoenix は購読（phx_join）を送るまで何も流さず、
// 一定時間 heartbeat が無いと切断する。ここでは V2 の JSON 配列形式 [join_ref, ref, topic, event, payload] を扱う。
//
// 送信するのは phx_join（購読）と heartbeat（生存確認）と phx_leave（購読解除）だけ。
// コメント投稿など配信に影響する送信は行わない（決裁の範囲）。

import { extractComments } from "./ws-feed";
import type { GiftCommentInput } from "../whowatch/gift-normalize";

export const PHOENIX_VSN = "2.0.0";
/** Phoenix 既定の heartbeat 間隔は 30 秒。サーバ側の timeout（既定 60 秒）より短ければよい */
export const PHOENIX_HEARTBEAT_MS = 30_000;

/** V2 形式の 1 フレーム */
export interface PhoenixFrame {
  joinRef: string | null;
  ref: string | null;
  topic: string;
  event: string;
  payload: unknown;
}

/**
 * comment_server_url（…/socket）から実際の接続 URL を作る。
 * 実測どおり /socket/websocket?vsn=2.0.0 にし、jwt があれば token= で渡す（無くても握手は通る）
 */
export function phoenixSocketUrl(commentServerUrl: string | null | undefined, jwt: string | null | undefined): string | null {
  if (!commentServerUrl || !/^wss?:\/\//i.test(commentServerUrl)) return null;
  try {
    const u = new URL(commentServerUrl);
    if (!u.pathname.endsWith("/websocket")) u.pathname = `${u.pathname.replace(/\/$/, "")}/websocket`;
    u.searchParams.set("vsn", PHOENIX_VSN);
    if (jwt) u.searchParams.set("token", jwt);
    return u.toString();
  } catch {
    return null;
  }
}

/** 送信フレームを V2 形式の文字列にする */
export function encodeFrame(f: PhoenixFrame): string {
  return JSON.stringify([f.joinRef, f.ref, f.topic, f.event, f.payload ?? {}]);
}

export function joinFrame(topic: string, ref: string, payload: Record<string, unknown> = {}): string {
  return encodeFrame({ joinRef: ref, ref, topic, event: "phx_join", payload });
}

export function leaveFrame(topic: string, joinRef: string, ref: string): string {
  return encodeFrame({ joinRef, ref, topic, event: "phx_leave", payload: {} });
}

export function heartbeatFrame(ref: string): string {
  return encodeFrame({ joinRef: null, ref, topic: "phoenix", event: "heartbeat", payload: {} });
}

/** 受信データを V2 フレームとして読む。形が違えば null（生ログ側で扱う） */
export function decodeFrame(data: unknown): PhoenixFrame | null {
  if (typeof data !== "string") return null;
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  if (!Array.isArray(v) || v.length !== 5) return null;
  const [joinRef, ref, topic, event, payload] = v as unknown[];
  if (typeof topic !== "string" || typeof event !== "string") return null;
  return { joinRef: joinRef == null ? null : String(joinRef), ref: ref == null ? null : String(ref), topic, event, payload };
}

/** phx_reply の結果。参加が通ったか（"ok"）拒否されたか（"error"）を見る */
export function replyStatus(f: PhoenixFrame): "ok" | "error" | null {
  if (f.event !== "phx_reply") return null;
  const p = f.payload as { status?: unknown } | null;
  return p?.status === "ok" ? "ok" : p?.status === "error" ? "error" : null;
}

/** フレームの payload からコメントらしいものを拾う（形式は入れ子まで探す。ws-feed.extractComments と同じ） */
export function commentsFromFrame(f: PhoenixFrame): Array<GiftCommentInput & { comment_type: string }> {
  if (f.event === "phx_reply" || f.event === "phx_error" || f.event === "phx_close" || f.topic === "phoenix") return [];
  return extractComments(f.payload);
}

/**
 * 購読するトピック名の候補。正解は個人ツール（whowatch-feed）のログで確定させる想定だが、
 * 無い場合は順に phx_join を試し、"ok" が返ったものを採用する
 */
export function topicCandidates(liveId: string): string[] {
  return [`live:${liveId}`, `lives:${liveId}`, `live_comments:${liveId}`, `comments:${liveId}`, `room:${liveId}`, `live:lobby`];
}

/** 参加の試行 1 件（トピック × 参加時のデータ） */
export interface JoinCandidate {
  topic: string;
  payload: Record<string, unknown>;
  /** 表示用の短い名前（jwt の値は含めない） */
  label: string;
}

/**
 * 参加（phx_join）の候補を「トピック × 参加データ」で並べる。
 * 2026-09-25 実測（社長がふわっち公式サイトの通信を F12 で確認）:
 *   ["1","1","room:76347155","phx_join",{"p":"<jwt>"}] → {"status":"ok"}
 * つまりチャンネルは room:<配信ID>、参加データは {"p": jwt}。これを先頭にし、
 * 万一に備えて従来の候補（live:lobby の各種、他トピック）を後ろに残す
 */
export function joinCandidates(liveId: string, jwt: string | null | undefined): JoinCandidate[] {
  const idNum = Number(liveId);
  const id: number | string = Number.isFinite(idNum) ? idNum : liveId;
  const room: JoinCandidate[] = jwt
    ? [
        { topic: `room:${liveId}`, payload: { p: jwt }, label: `room:${liveId}{p}` },
        { topic: `room:${liveId}`, payload: { p: jwt, live_id: id }, label: `room:${liveId}{p+live_id}` },
      ]
    : [{ topic: `room:${liveId}`, payload: {}, label: `room:${liveId}{}` }];
  const lobby: Array<[string, Record<string, unknown>]> = [
    ["jwt", jwt ? { jwt } : {}],
    ["jwt+live_id", jwt ? { jwt, live_id: id } : { live_id: id }],
    ["token+live_id", jwt ? { token: jwt, live_id: id } : { live_id: id }],
    ["live_id", { live_id: id }],
    ["jwt+live_id(文字列)", jwt ? { jwt, live_id: String(liveId) } : { live_id: String(liveId) }],
    ["jwt+id", jwt ? { jwt, id } : { id }],
    ["token+id", jwt ? { token: jwt, id } : { id }],
    ["jwt+live_id+user", jwt ? { jwt, live_id: id, user_id: null } : { live_id: id }],
  ];
  const out: JoinCandidate[] = [...room, ...lobby.map(([label, payload]) => ({ topic: "live:lobby", payload, label: `live:lobby{${label}}` }))];
  for (const topic of topicCandidates(liveId)) {
    if (topic === "live:lobby" || topic === `room:${liveId}`) continue;
    out.push({ topic, payload: jwt ? { token: jwt } : {}, label: `${topic}{token}` });
  }
  return out;
}

/** ref を単調増加で払い出す（同じ接続内で一意なら十分） */
export function createRefCounter(): () => string {
  let n = 0;
  return () => String(++n);
}
