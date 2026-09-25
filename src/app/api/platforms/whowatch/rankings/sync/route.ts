import { NextResponse } from "next/server";
import { and, eq, isNotNull, lte, gte } from "drizzle-orm";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators } from "@/lib/db/schema";
import { syncSimulatorRanking } from "@/lib/whowatch/ranking-sync";
import { verifySyncKey } from "@/lib/whowatch/sync-auth";
import { findSyncRoute } from "@/lib/sync-routes";

const ROUTE_PATH = "/api/platforms/whowatch/rankings/sync";

/**
 * POST /api/platforms/whowatch/rankings/sync → 開催中の全シミュレーターのランキングを 1 回同期する（E2 の 5 分 cron 用）
 *
 * - 呼び出し元: .github/workflows/ranking-sync.yml（GitHub Actions cron）。ユーザーセッションには依存しない
 * - 認証: middleware.ts が src/lib/sync-routes.ts の SYNC_ROUTES を見てこのパスを素通しし、
 *   ここで最初に X-Sync-Key を検証する。未設定・未指定・不一致はすべて 401 の JSON（リダイレクトはしない）。
 *   このファイル自身が SYNC_ROUTES に登録されているかも確認する（登録漏れは 500 で気づけるようにする）
 * - DB: createDbClient()（DATABASE_URL の postgres ロール = RLS をバイパスするサービス接続）で
 *   全ユーザーの active シミュレーターを対象にする
 * - 対象: status=active かつ ranking_type あり かつ start_time <= now <= end_time
 */
export async function POST(request: Request) {
  const route = findSyncRoute(ROUTE_PATH);
  if (!route) return NextResponse.json({ error: `route not registered in SYNC_ROUTES: ${ROUTE_PATH}` }, { status: 500 });

  const auth = verifySyncKey(request.headers.get("x-sync-key"), process.env[route.envKey]);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });

  const db = createDbClient();
  const now = new Date();
  const targets = await db
    .select()
    .from(eventSimulators)
    .where(
      and(
        eq(eventSimulators.status, "active"),
        isNotNull(eventSimulators.rankingType),
        lte(eventSimulators.startTime, now),
        gte(eventSimulators.endTime, now),
      ),
    );

  // ?dry=1: 対象件数だけ返し、whowatch APIへの問い合わせ・DB書き込みは行わない。
  // 認証(X-Sync-Key)・DB接続・対象抽出クエリは実行するため、Cloudflare Cron移設後の疎通確認や
  // 手動デバッグに使える(cron自体は毎回本番同期を行い、dryはここでの動作確認専用)。
  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  if (dryRun) {
    return NextResponse.json({ ok: true, at: now.toISOString(), dryRun: true, targets: targets.length });
  }

  const results: Array<{ id: string; rankingType: string | null; ok: boolean; myRank: number | null; snapshotId: string | null; error?: string }> = [];
  for (const ev of targets) {
    try {
      const r = await syncSimulatorRanking(db, ev, { now });
      results.push({ id: ev.id, rankingType: ev.rankingType, ok: true, myRank: r.myEntry?.rank ?? null, snapshotId: r.snapshotId });
    } catch (err) {
      console.warn("[rankings/sync] failed", ev.id, err);
      results.push({ id: ev.id, rankingType: ev.rankingType, ok: false, myRank: null, snapshotId: null, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ok: true, at: now.toISOString(), targets: targets.length, results });
}
