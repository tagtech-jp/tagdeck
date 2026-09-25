// ふわっちポーリング中継サーバー
// 公開 API (api.whowatch.tv) を 5 秒間隔でポーリングし Supabase events テーブルに INSERT する
// Keep-alive ping: KEEP_ALIVE_INTERVAL_MS ごとに自身の /health を fetch して Render Free スリープを防ぐ
// 設計参照: docs/migration/phase3_plan_v1.0.md §7.1

import http from "node:http";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 10000);
const POLL_INTERVAL_MS = 5_000;
const KEEP_ALIVE_INTERVAL_MS = Number(process.env.KEEP_ALIVE_INTERVAL_MS ?? 840_000);
const USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)";
const WHOWATCH_BASE = "https://api.whowatch.tv";
const FETCH_TIMEOUT_MS = 4_000;

// ---------------------------------------------------------------------------
// Supabase クライアント（Service Role Key: RLS をバイパスして INSERT する）
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!supabaseUrl || !supabaseKey) {
  console.error("[whowatch-poller] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ---------------------------------------------------------------------------
// ふわっち公開 API 型定義（api.whowatch.tv の実レスポンスに準拠）
// ---------------------------------------------------------------------------

interface WhowatchLive {
  live_id: string;
  title: string;
  view_num: number;
  total_point: number;
  live_started_at: number;
}

interface LivesHistoryResponse {
  lives: WhowatchLive[];
}

interface LiveDetailResponse {
  live: WhowatchLive | null;
}

// ---------------------------------------------------------------------------
// ふわっち公開 API 呼び出し（AGENTS.md 制約: 公開 API + 5 秒ポーリング厳守）
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "x-whowatch-device-id": process.env.WHOWATCH_DEVICE_ID ?? "",
        origin: "https://whowatch.tv",
        referer: "https://whowatch.tv/",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function fetchLatestLive(userId: string): Promise<WhowatchLive | null> {
  const data = await fetchJson<LivesHistoryResponse>(
    `${WHOWATCH_BASE}/users/${userId}/lives_history?count=1`
  );
  return data?.lives?.[0] ?? null;
}

async function fetchLiveDetail(liveId: string): Promise<WhowatchLive | null> {
  const data = await fetchJson<LiveDetailResponse>(`${WHOWATCH_BASE}/lives/${liveId}`);
  return data?.live ?? null;
}

// ---------------------------------------------------------------------------
// ポーリングセッション管理
// ---------------------------------------------------------------------------

interface PollingSession {
  streamerId: string;
  whowatchUserId: string;
  intervalId: ReturnType<typeof setInterval>;
}

const sessions = new Map<string, PollingSession>();

async function pollOnce(streamerId: string, whowatchUserId: string): Promise<void> {
  const latest = await fetchLatestLive(whowatchUserId);
  if (!latest) return;

  const detail = await fetchLiveDetail(latest.live_id);
  if (!detail) return;

  // events テーブルへ INSERT（存在する 7 カラムのみ使用）
  const { error } = await supabase.from("events").insert({
    streamer_id: streamerId,
    platform: "whowatch",
    event_type: "live_poll",
    payload: {
      live_id: detail.live_id,
      title: detail.title,
      view_num: detail.view_num,
      total_point: detail.total_point,
      live_started_at: detail.live_started_at,
    },
    occurred_at: new Date().toISOString(),
  });

  if (error) {
    console.error(`[whowatch-poller] INSERT error (streamer=${streamerId}):`, error.message);
  }
}

function startSession(streamerId: string, whowatchUserId: string): void {
  if (sessions.has(streamerId)) {
    console.log(`[whowatch-poller] session already active: ${streamerId}`);
    return;
  }
  const intervalId = setInterval(() => {
    pollOnce(streamerId, whowatchUserId).catch((err: unknown) => {
      console.error(`[whowatch-poller] poll error (streamer=${streamerId}):`, err);
    });
  }, POLL_INTERVAL_MS);

  sessions.set(streamerId, { streamerId, whowatchUserId, intervalId });
  console.log(`[whowatch-poller] session started: ${streamerId} (userId=${whowatchUserId})`);
}

function stopSession(streamerId: string): void {
  const session = sessions.get(streamerId);
  if (!session) return;
  clearInterval(session.intervalId);
  sessions.delete(streamerId);
  console.log(`[whowatch-poller] session stopped: ${streamerId}`);
}

// ---------------------------------------------------------------------------
// HTTP サーバー
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // GET /health
  if (method === "GET" && url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "whowatch-poller", sessions: sessions.size }));
    return;
  }

  // POST /start — { streamerId: string, whowatchUserId: string }
  if (method === "POST" && url === "/start") {
    try {
      const body = await readBody(req);
      const { streamerId, whowatchUserId } = JSON.parse(body) as {
        streamerId: string;
        whowatchUserId: string;
      };
      if (!streamerId || !whowatchUserId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "streamerId and whowatchUserId are required" }));
        return;
      }
      startSession(streamerId, whowatchUserId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, streamerId }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
    }
    return;
  }

  // POST /stop — { streamerId: string }
  if (method === "POST" && url === "/stop") {
    try {
      const body = await readBody(req);
      const { streamerId } = JSON.parse(body) as { streamerId: string };
      if (!streamerId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "streamerId is required" }));
        return;
      }
      stopSession(streamerId);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, streamerId }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid JSON" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[whowatch-poller] listening on port ${PORT}`);
});

// ---------------------------------------------------------------------------
// Keep-alive: Render Free Tier のスリープを防ぐ自己 ping
// ---------------------------------------------------------------------------

const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;
if (renderExternalUrl) {
  setInterval(() => {
    fetch(`${renderExternalUrl}/health`, { signal: AbortSignal.timeout(5_000) }).catch(
      (err: unknown) => console.warn("[whowatch-poller] keep-alive ping failed:", err)
    );
  }, KEEP_ALIVE_INTERVAL_MS);
  console.log(`[whowatch-poller] keep-alive ping enabled (interval=${KEEP_ALIVE_INTERVAL_MS}ms)`);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on("SIGTERM", () => {
  console.log("[whowatch-poller] SIGTERM received, shutting down");
  for (const session of sessions.values()) {
    clearInterval(session.intervalId);
  }
  sessions.clear();
  server.close(() => process.exit(0));
});
