import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { resolveWhowatchDeviceId } from "@/lib/platforms/whowatch";
import { fetchLive, WhowatchLiveApiError } from "@/lib/whowatch/live-feed";
import { redactSecret, wsUrlToHttp } from "@/lib/live/ws-feed";

/**
 * GET /api/platforms/whowatch/live/ws/probe?liveId= → コメントサーバ（WebSocket）への握手をサーバ側から試し、結果を返す診断。
 * 2026-09-25: ブラウザからの直結が code=1006（握手で拒否）で失敗した。ブラウザは Origin ヘッダを自分のドメインで
 * 固定送信するため「Origin 制限か／認証方式か／ws:// か」を見分けられない。Workers の fetch() は Upgrade: websocket で
 * 握手でき、ヘッダも指定できるので、いくつかの組み合わせを試して HTTP ステータスを返す。
 * - 受信のみ（決裁の範囲）。認証フレーム等の送信は一切しない
 * - jwt は応答から伏せる（redactSecret）。DB には触らない
 * - 握手が通った場合は最初のメッセージを最大 WAIT_MS だけ待ち、先頭 500 文字を返す（形式確定の証跡）
 */
const querySchema = z.object({ liveId: z.string().regex(/^\d{1,20}$/) });
const WAIT_MS = 2_500;
const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";

interface Variant {
  name: string;
  url: string;
  headers: Record<string, string>;
}
interface VariantResult {
  name: string;
  status: number | null;
  upgraded: boolean;
  firstMessage: string | null;
  closeCode: number | null;
  error: string | null;
  responseHeaders?: Record<string, string>;
}

async function tryHandshake(v: Variant, jwt: string | null): Promise<VariantResult> {
  const out: VariantResult = { name: v.name, status: null, upgraded: false, firstMessage: null, closeCode: null, error: null };
  try {
    const res = await fetch(v.url, { headers: { Upgrade: "websocket", ...v.headers } });
    out.status = res.status;
    // 診断に役立つヘッダだけ（Set-Cookie 等は載せない）
    const keep = ["content-type", "sec-websocket-protocol", "www-authenticate", "cf-ray", "server"];
    out.responseHeaders = Object.fromEntries([...res.headers.entries()].filter(([k]) => keep.includes(k.toLowerCase())).map(([k, val]) => [k, redactSecret(val, jwt)]));
    const ws = (res as Response & { webSocket?: WebSocket }).webSocket;
    if (res.status !== 101 || !ws) {
      // 101 以外は本文の先頭だけ（HTML のエラーページ等）
      const body = await res.text().catch(() => "");
      if (body) out.error = redactSecret(body.slice(0, 300), jwt);
      return out;
    }
    out.upgraded = true;
    (ws as WebSocket & { accept: () => void }).accept();
    const first = await new Promise<{ message?: string; closeCode?: number } | null>((resolve) => {
      const t = setTimeout(() => resolve(null), WAIT_MS);
      ws.addEventListener("message", (ev) => {
        clearTimeout(t);
        resolve({ message: typeof ev.data === "string" ? ev.data : `[binary ${(ev.data as ArrayBuffer).byteLength} bytes]` });
      });
      ws.addEventListener("close", (ev) => {
        clearTimeout(t);
        resolve({ closeCode: ev.code });
      });
      ws.addEventListener("error", () => {
        clearTimeout(t);
        resolve({ closeCode: -1 });
      });
    });
    if (first?.message !== undefined) out.firstMessage = redactSecret(first.message.slice(0, 500), jwt);
    if (first?.closeCode !== undefined) out.closeCode = first.closeCode;
    try {
      ws.close(1000, "probe done");
    } catch {
      // 既に閉じていれば無視
    }
    return out;
  } catch (e) {
    out.error = redactSecret(e instanceof Error ? e.message : String(e), jwt);
    return out;
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = querySchema.safeParse({ liveId: new URL(request.url).searchParams.get("liveId") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "liveId（数値）が必要です" }, { status: 400 });

  let live;
  try {
    live = await fetchLive(parsed.data.liveId, 0);
  } catch (err) {
    const status = err instanceof WhowatchLiveApiError ? 502 : 500;
    return NextResponse.json({ error: "配信データを取得できませんでした", detail: err instanceof Error ? err.message : String(err) }, { status });
  }
  const { url, jwt } = live.ws;
  const http = wsUrlToHttp(url);
  const urlInfo = url
    ? (() => {
        try {
          const u = new URL(url);
          return { scheme: u.protocol.replace(":", ""), host: u.host, pathname: u.pathname, query: redactSecret(u.search, jwt), hasJwtInUrl: Boolean(jwt && url.includes(jwt)) };
        } catch {
          return { raw: redactSecret(url, jwt) };
        }
      })()
    : null;
  if (!http) {
    return NextResponse.json({ liveId: parsed.data.liveId, liveStatus: live.liveStatus, hasJwt: Boolean(jwt), urlInfo, variants: [], note: url ? "ws(s) 以外の URL のため握手を試していない" : "応答に comment_server_url が無い" });
  }

  const base = { "User-Agent": USER_AGENT, "x-whowatch-device-id": resolveWhowatchDeviceId() };
  const withJwt = (() => {
    if (!jwt) return null;
    const u = new URL(http);
    u.searchParams.set("jwt", jwt);
    return u.toString();
  })();
  // 2026-09-25 実測（v1）: comment_server_url は wss://ws.whowatch.tv/socket で、そのままの握手は Origin/認証に
  // 関係なく全て 404 だった。/socket を土台に /socket/websocket?vsn=2.0.0 を使う Phoenix Channels 型の可能性が高いので、
  // v2 ではそのパス形式を中心に試す（受信のみ。参加メッセージ等の送信はしない）
  const withQuery = (baseUrl: string, params: Record<string, string>) => {
    const u = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };
  const phoenix = http.replace(/\/$/, "") + "/websocket";
  const originWw = { ...base, Origin: "https://whowatch.tv" };
  const variants: Variant[] = [
    { name: "A: /socket そのまま + Origin whowatch.tv（v1 と同じ・基準）", url: http, headers: originWw },
    { name: "P1: /socket/websocket?vsn=2.0.0 + Origin whowatch.tv", url: withQuery(phoenix, { vsn: "2.0.0" }), headers: originWw },
    ...(jwt
      ? [
          { name: "P2: /socket/websocket?vsn=2.0.0&token=jwt + Origin whowatch.tv", url: withQuery(phoenix, { vsn: "2.0.0", token: jwt }), headers: originWw },
          { name: "P3: /socket/websocket?vsn=2.0.0&jwt=jwt + Origin whowatch.tv", url: withQuery(phoenix, { vsn: "2.0.0", jwt }), headers: originWw },
          { name: "P4: /socket/websocket?vsn=2.0.0&token=jwt + Origin tagdeck.jp（ブラウザ相当）", url: withQuery(phoenix, { vsn: "2.0.0", token: jwt }), headers: { ...base, Origin: "https://tagdeck.jp" } },
        ]
      : []),
    { name: "P5: /socket/websocket（vsn なし）+ Origin whowatch.tv", url: phoenix, headers: originWw },
    ...(withJwt ? [{ name: "D: /socket?jwt=jwt + Origin whowatch.tv（v1 と同じ）", url: withJwt, headers: originWw }] : []),
  ];
  // 直列に試す（同時に開くとサーバ側の接続数制限に当たる可能性がある）。サブリクエストは最大 8（Free の上限 50 に余裕）
  const results: VariantResult[] = [];
  for (const v of variants) results.push(await tryHandshake(v, jwt));

  const res = NextResponse.json({ liveId: parsed.data.liveId, liveStatus: live.liveStatus, hasJwt: Boolean(jwt), urlInfo, variants: results, at: new Date().toISOString() });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
