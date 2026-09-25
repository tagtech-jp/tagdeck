import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db/client";
import { syncAllEventDetails } from "@/lib/whowatch/event-detail-sync";
import { verifySyncKey } from "@/lib/whowatch/sync-auth";
import { sendNotifyGw } from "@/lib/notify-gw";
import { findSyncRoute } from "@/lib/sync-routes";

const ROUTE_PATH = "/api/platforms/whowatch/events/sync";
const EVENT_KEY_RE = /^[a-z0-9_\-]{1,100}$/i;

/**
 * POST /api/platforms/whowatch/events/sync → open/pre の全イベントの詳細（名前・区分・ランキング構造・ルール・periods）を同期する
 * - 呼び出し元: .github/workflows/daily-sync.yml（毎日）と event-detail-sync.yml（workflow_dispatch・即時）
 * - 認証: X-Sync-Key。middleware.ts が SYNC_ROUTES（src/lib/sync-routes.ts）を見てこのパスを素通しする。
 *   未設定・未指定・不一致は 401 JSON。このファイル自身が SYNC_ROUTES に登録されているかも確認する
 * - クエリ: ?force=1 で DB の鮮度に関係なく取り直す（既定は 10 分以内なら DB）
 *          ?limit=3（1 リクエストの件数。Workers のサブリクエスト上限対策）、?cursor=<前回の next_cursor>、?event_key=<単体実行>
 * - 応答の next_cursor が null になるまで呼び出し元がループする
 * - 失敗があれば notify-gw に WARN を 1 通（NOTIFY_GW_KEY 未設定なら送らない）
 */
export async function POST(request: Request) {
  const route = findSyncRoute(ROUTE_PATH);
  if (!route) return NextResponse.json({ error: `route not registered in SYNC_ROUTES: ${ROUTE_PATH}` }, { status: 500 });

  const auth = verifySyncKey(request.headers.get("x-sync-key"), process.env[route.envKey]);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const force = sp.get("force") === "1";
  const limitRaw = Number(sp.get("limit") ?? "");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
  const cursor = sp.get("cursor") || null;
  const eventKey = sp.get("event_key") || null;
  if (eventKey && !EVENT_KEY_RE.test(eventKey)) return NextResponse.json({ error: "invalid event_key" }, { status: 400 });
  const db = createDbClient();
  const result = await syncAllEventDetails(db, { force, limit, cursor, eventKey });

  if (result.failed > 0) {
    await sendNotifyGw({
      agent_id: "tagdeck",
      action: "whowatch_event_detail_sync",
      severity: "WARN",
      result: "failure",
      summary: `ふわっちイベント詳細同期: ${result.failed}/${result.processed} 件失敗`,
      fingerprint: `tagdeck:event_detail_sync:${result.at.slice(0, 10)}`,
      meta: { failed: result.results.filter((r) => !r.ok).map((r) => ({ eventKey: r.eventKey, stage: r.stage, error: r.error })) },
    });
  }

  return NextResponse.json({ ok: true, ...result });
}
