import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { errorDetail } from "@/lib/error-detail";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators, rankingSnapshots, whowatchEvents } from "@/lib/db/schema";
import { estimatePaceParameters } from "@/lib/events/monte-carlo";
import { findSyncRoute } from "@/lib/sync-routes";
import { forecastRank, rivalKey } from "@/lib/whowatch/rank-forecast";
import { verifySyncKey } from "@/lib/whowatch/sync-auth";
import { describeDbError } from "@/lib/whowatch/sanitize";

const ROUTE_PATH = "/api/platforms/whowatch/simulators/export";
/** 予測に使うランキングの記録の件数。画面（useRankingSnapshots の既定）と同じにして、画面と同じ数字を返す */
const FORECAST_SNAPSHOTS = 96;
/** 自分の点数の推移の上限（5 分ごと・約 20 日分） */
const HISTORY_LIMIT = 6000;
/** 予測を付けるのは、終了から 7 日以内のシミュレーターだけ（古いものに DB の読み込みと試行を使わない） */
const FORECAST_WINDOW_MS = 7 * 24 * 3_600_000;

/**
 * GET /api/platforms/whowatch/simulators/export → イベント勝率シミュレーターの目標と進捗を外部ツール向けに JSON で返す（2026-10-02）
 * - 用途: 運営者の配信分析ツール（stream-insight）が、TagDeck で設定したイベント目標を読む
 * - 認証:
 *   - X-Sync-Key（RANKING_SYNC_KEY）→ 運営者 1 人分だけを返す。対象は環境変数 EXPORT_OWNER_USER_ID（users.id）。
 *     共有キーで任意の利用者のデータを読めないよう、利用者の指定はリクエストから受け付けない。未設定なら configured=false の空配列
 *   - ヘッダが無ければログイン Cookie でも可 → ログイン中の本人の分を返す（ブラウザでの確認用）
 * - 返すのは本人の目標・期間・進捗だけ。ライバル（他の配信者）の名前や点数そのものは返さない。論理削除（status=deleted）は除く
 * - 2026-10-03 追加（stream-insight の「イベントの追い上げ計画」用）:
 *   - forecast: ランキング型のふわっち連携イベントで目標順位があるものに、画面（EventDashboard）と同じ入力・同じ関数（forecastRank）で
 *     出した予測の数字（目標順位に入るのに必要な追加 pt・達成確率・予想順位など）。ライバルの一覧（rivals）は含めない
 *   - score_history: 自分の点数の推移（ranking_snapshots.my_point・5 分ごと）。配信中に何 pt 伸びたかを stream-insight が計算する
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
        manualScore: eventSimulators.manualScore, updatedAt: eventSimulators.updatedAt, rankingType: eventSimulators.rankingType,
      })
      .from(eventSimulators)
      .where(and(eq(eventSimulators.userId, who.userId), ne(eventSimulators.status, "deleted")));
    const list = Array.isArray(rows) ? rows : [];
    const keys = await loadEventKeys(db, list.map((r) => r.whowatchEventId).filter((v): v is number => typeof v === "number"));
    const now = new Date();
    const extras = new Map<string, Awaited<ReturnType<typeof loadForecast>>>();
    for (const r of list) {
      if (r.platform === "whowatch" && r.rankingType && r.targetRank && new Date(r.endTime).getTime() > now.getTime() - FORECAST_WINDOW_MS) {
        extras.set(r.id, await loadForecast(db, r, now));
      }
    }
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
      ranking_type: r.rankingType ?? null,
      forecast: extras.get(r.id)?.forecast ?? null,
      forecast_error: extras.get(r.id)?.error ?? null,
      score_history: extras.get(r.id)?.history ?? [],
    }));
    return noStore(NextResponse.json({ ...base, configured: true, count: simulators.length, simulators }));
  } catch (e) {
    const message = describeDbError(e);
    console.error("[simulators/export] 失敗", message);
    return NextResponse.json({ error: "シミュレーターを取得できませんでした", ...errorDetail(message) }, { status: 500 });
  }
}

interface SimulatorForForecast {
  id: string;
  targetRank: number | null;
  startTime: Date | string;
  endTime: Date | string;
  currentScore: number;
}

/** 画面（EventDashboard の snapshotForecast）と同じ手順で予測を出し、自分の点数の推移を添える。失敗しても目標は返す */
async function loadForecast(db: ReturnType<typeof createDbClient>, sim: SimulatorForForecast, now: Date) {
  try {
    const latestRows = await db
      .select({ capturedAt: rankingSnapshots.capturedAt, entries: rankingSnapshots.entries, myRank: rankingSnapshots.myRank, myPoint: rankingSnapshots.myPoint })
      .from(rankingSnapshots)
      .where(eq(rankingSnapshots.simulatorId, sim.id))
      .orderBy(desc(rankingSnapshots.capturedAt))
      .limit(FORECAST_SNAPSHOTS);
    const historyRows = await db
      .select({ capturedAt: rankingSnapshots.capturedAt, myPoint: rankingSnapshots.myPoint })
      .from(rankingSnapshots)
      .where(and(eq(rankingSnapshots.simulatorId, sim.id), isNotNull(rankingSnapshots.myPoint)))
      .orderBy(asc(rankingSnapshots.capturedAt))
      .limit(HISTORY_LIMIT);
    const history = (Array.isArray(historyRows) ? historyRows : []).map((h) => ({ at: iso(h.capturedAt), score: h.myPoint as number }));
    const snaps = Array.isArray(latestRows) ? latestRows : [];
    if (snaps.length === 0 || !sim.targetRank) return { forecast: null, error: null, history };
    const sorted = [...snaps].sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
    const latest = sorted[sorted.length - 1];
    const me = latest.myRank ? latest.entries.find((e) => e.rank === latest.myRank) ?? null : null;
    const myHistory = sorted.filter((s) => s.myPoint !== null).map((s) => ({ timestamp: new Date(s.capturedAt), score: s.myPoint as number }));
    const myPace = estimatePaceParameters(myHistory);
    const f = forecastRank({
      snapshots: sorted.map((s) => ({ capturedAt: s.capturedAt, entries: s.entries, myPoint: s.myPoint })),
      myPoint: latest.myPoint ?? sim.currentScore,
      myPaceMean: myPace.mean,
      myPaceStdDev: myPace.stdDev,
      targetRank: sim.targetRank,
      now,
      endTime: new Date(sim.endTime),
      eventStart: new Date(sim.startTime),
      myKey: me ? rivalKey(me) : null,
    });
    // 数字だけを返す（f.rivals はライバルの名前と点数を含むので返さない）
    const forecast = {
      computed_at: now.toISOString(),
      target_rank: sim.targetRank,
      rank_probability: f.rankProbability,
      expected_rank: f.expectedRank,
      current_rank: f.currentRank,
      current_point: f.currentPoint,
      required_points: f.requiredPoints,
      target_border_points: f.targetBorderPoints,
      my_final_points: f.myFinalPoints,
      remaining_hours: f.remainingHours,
      remaining_days: f.remainingDays,
      snapshot_count: f.snapshotCount,
      final_day_coefficient: f.finalDayCoefficient,
      note: f.note,
    };
    return { forecast, error: null, history };
  } catch (e) {
    const message = describeDbError(e);
    console.warn("[simulators/export] 予測の計算に失敗", message);
    return { forecast: null, error: message, history: [] as Array<{ at: string | null; score: number }> };
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
