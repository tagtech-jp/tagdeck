/// <reference types="@cloudflare/workers-types" />
// .open-next/worker.js は `opennextjs-cloudflare build` が生成するファイル。
// `pnpm exec tsc --noEmit` はビルド前(CI・ローカルとも型チェックの方が先)に走るため実体がなく、
// 相対パス指定のためambient `declare module` でも型解決できない(TypeScriptの既知の制約)。
// wrangler deploy時のバンドル(esbuild)は実ファイルとして解決するため実行時は問題ない。
// @ts-expect-error TS2307: .open-next/worker.js はビルド後にのみ存在する
import handler from "../.open-next/worker.js";
import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators } from "@/lib/db/schema";
import { syncSimulatorRanking } from "@/lib/whowatch/ranking-sync";

// pg_try_advisory_xact_lock 用の固定キー。E2 ランキング同期専用であることが分かればよいので
// 値そのものに意味はない(他機能のロックキーと衝突しない値を適当に割り当てただけ)。
const RANKING_SYNC_LOCK_KEY = 861025;

/**
 * Cloudflare Cron Trigger(5分毎)から呼ばれる本体。
 * .github/workflows/ranking-sync.yml が呼んでいた POST /api/platforms/whowatch/rankings/sync と
 * 同じ syncSimulatorRanking() を HTTP を経由せず直接呼ぶ(X-Sync-Key 認証は不要になる)。
 */
export async function runRankingSync(env: Record<string, unknown>) {
  // OpenNext の fetch ハンドラは populateProcessEnv() を Request 経由で初回リクエスト時に1回だけ呼ぶ。
  // scheduled イベント単独(コールドスタート直後など)ではまだ process.env に値が入っていない
  // 可能性があるため、createDbClient() が読む DATABASE_URL 等を明示的に補う。
  // (src/init.js の populateProcessEnv 実装を踏襲: 文字列値のみ・既存値は上書きしない)
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string" && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  const db = createDbClient();

  // DATABASE_URL は Supabase の「トランザクションプーラー」経由(db/client.ts の
  // `prepare: false // Supabase のトランザクションプーラー対応` で判明。値は見ていない)。
  // プーラーのtransactionモードは「1トランザクションの間だけ」同じ物理接続に固定する方式のため、
  // セッション単位の pg_try_advisory_lock だと取得と解放が別の物理接続に渡ってしまい、
  // ロックが解放されないまま残る恐れがある。トランザクション単位の pg_try_advisory_xact_lock
  // (COMMIT/ROLLBACKで自動解放、明示的なunlockは無い/できない)を使い、
  // 対象取得〜同期処理を丸ごと1つのトランザクションに収める。
  //
  // 同期は数分かかりうる一方 cron は5分毎に発火するため、前回実行が終わっていない状態で
  // 次回が重なるとホワウォッチAPIへの二重リクエストや書き込みの無駄撃ちになる
  // (DB破損の危険はない: event_simulators の UPDATE も ranking_snapshots の INSERT も
  // 重複しても整合性は壊れない)。ロックが取れなければ今回はスキップする。
  await db.transaction(async (tx) => {
    const lockRows = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${RANKING_SYNC_LOCK_KEY}) as locked`,
    );
    if (!lockRows[0]?.locked) {
      console.warn("[ranking-sync/scheduled] previous run still in progress, skipping this tick");
      return;
    }

    const now = new Date();
    const targets = await tx
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

    let ok = 0;
    let failed = 0;
    for (const ev of targets) {
      try {
        await syncSimulatorRanking(tx, ev, { now });
        ok++;
      } catch (err) {
        failed++;
        console.warn("[ranking-sync/scheduled] failed", ev.id, err);
      }
    }
    console.log(`[ranking-sync/scheduled] targets=${targets.length} ok=${ok} failed=${failed}`);
  });
}

export default {
  fetch: handler.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runRankingSync(env as Record<string, unknown>));
  },
} satisfies ExportedHandler<Record<string, unknown>>;
