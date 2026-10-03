import { NextResponse } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators, whowatchEvents } from "@/lib/db/schema";
import { findSyncRoute } from "@/lib/sync-routes";
import { verifySyncKey } from "@/lib/whowatch/sync-auth";
import { describeDbError } from "@/lib/whowatch/sanitize";

const ROUTE_PATH = "/api/platforms/whowatch/simulators/export";

/**
 * GET /api/platforms/whowatch/simulators/export → イベント勝率シミュレーターの目標と進捗を外部ツール向けに JSON で返す（2026-10-02）
 * - 用途: 運営者の配信分析ツール（stream-insight）が、TagDeck で設定したイベント目標を読む
 * - 認証:
 *   - X-Sync-Key（RANKING_SYNC_KEY）→ 運営者 1 人分だけを返す。対象は環境変数 EXPORT_OWNER_USER_ID（users.id）。
 *     共有キーで任意の利用者のデータを読めないよう、利用者の指定はリクエストから受け付けない。未設定なら configured=false の空配列
 *   - ヘッダが無ければログイン Cookie でも可 → ログイン中の本人の分を返す（ブラウザでの確認用）
 * - 返すのは本人の目標・期間・進捗だけ。ライバル（他の配信者）のデータは返さない。論理削除（status=deleted）は除く
 * - 読み取り専用。POST も同じ処理（sync-routes.test.ts の共通ループが POST で検証するため）
 */
async function resolveUser(request: Request): Promise<{ userId: string | null } | NextResponse> {
  const route = findSyncRoute(ROUTE_PATH);
  if (!route) return NextResponse.json({ error: `route not registered in SYNC_ROUTES: ${ROUTE_PATH}` }, { status: 500 });
  const given = request.headers.get("x-sync-key");
  if (given !== null) {
    const auth = verifySyncKey(given, process.env[route.envKey]);
    if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });
    return { userId: process.env.EXPORT_OWNER_USER_ID || null };
  }
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { userId: user.id };
  } catch {
    // リクエスト外（テスト等）や Cookie 無しは未認証扱い
  }
  return NextResponse.json({ error: "missing X-Sync-Key (or login)" }, { status: 401 });
}

async function handle(request: Request): Promise<NextResponse> {
  const who = await resolveUser(request);
  if (who instanceof NextResponse) return who;
  const base = { exported_at: new Date().toISOString(), source: "event_simulators" };
  if (!who.userId) {
    return noStore(NextResponse.json({ ...base, configured: false, note: "EXPORT_OWNER_USER_ID is not set", count: 0, simulators: [] }));
  }
  const db = createDbClient();
  try {
    const rows = await db
      .select({
        id: eventSimulators.id, name: eventSimulators.name, platform: eventSimulators.platform,
        eventType: eventSimulators.eventType, targetScore: eventSimulators.targetScore, targetRank: eventSimulators.targetRank,
        whowatchEventId: eventSimulators.whowatchEventId, startTime: eventSimulators.startTime, endTime: eventSimulators.endTime,
        status: eventSimulators.status, currentScore: eventSimulators.currentScore, currentRank: eventSimulators.currentRank,
        manualScore: eventSimulators.manualScore, updatedAt: eventSimulators.updatedAt,
      })
      .from(eventSimulators)
      .where(and(eq(eventSimulators.userId, who.userId), ne(eventSimulators.status, "deleted")));
    const list = Array.isArray(rows) ? rows : [];
    const keys = await loadEventKeys(db, list.map((r) => r.whowatchEventId).filter((v): v is number => typeof v === "number"));
    const simulators = list.map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform,
      event_type: r.eventType,
      event_key: r.whowatchEventId != null ? keys.get(r.whowatchEventId) ?? null : null,
      whowatch_event_id: r.whowatchEventId,
      start_time: iso(r.startTime),
      end_time: iso(r.endTime),
      status: r.status,
      target_score: r.targetScore,
      target_rank: r.targetRank,
      current_score: r.manualScore ?? r.currentScore,
      current_score_source: r.manualScore != null ? "manual" : "auto",
      current_rank: r.currentRank,
      updated_at: iso(r.updatedAt),
    }));
    return noStore(NextResponse.json({ ...base, configured: true, count: simulators.length, simulators }));
  } catch (e) {
    const message = describeDbError(e);
    console.error("[simulators/export] 失敗", message);
    return NextResponse.json({ error: "シミュレーターを取得できませんでした", detail: message }, { status: 500 });
  }
}

async function loadEventKeys(db: ReturnType<typeof createDbClient>, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = await db.select({ id: whowatchEvents.id, eventKey: whowatchEvents.eventKey }).from(whowatchEvents).where(inArray(whowatchEvents.id, ids));
    return new Map((Array.isArray(rows) ? rows : []).map((r) => [r.id, r.eventKey]));
  } catch (e) {
    // event_key は付加情報。読めなくても目標は返す
    console.warn("[simulators/export] event_key の取得に失敗", describeDbError(e));
    return new Map();
  }
}

function iso(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
