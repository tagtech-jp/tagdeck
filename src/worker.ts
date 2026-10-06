/// <reference types="@cloudflare/workers-types" />
// .open-next/worker.js は `opennextjs-cloudflare build` が生成するファイル。
// `pnpm exec tsc --noEmit` はビルド前(CI・ローカルとも型チェックの方が先)に走るため実体がなく、
// 相対パス指定のためambient `declare module` でも型解決できない(TypeScriptの既知の制約)。
// wrangler deploy時のバンドル(esbuild)は実ファイルとして解決するため実行時は問題ない。
// @ts-expect-error TS2307: .open-next/worker.js はビルド後にのみ存在する
import handler from "../.open-next/worker.js";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators } from "@/lib/db/schema";
import { autoAssignRankingTypes, RANKING_EVENT_TYPES as RANKING_EVENT_TYPE_LIST } from "@/lib/whowatch/auto-ranking-type";
import { rollDailySimulators } from "@/lib/whowatch/daily-roll";
import { syncSimulatorRanking } from "@/lib/whowatch/ranking-sync";
import { describeDbError } from "@/lib/whowatch/sanitize";

// pg_try_advisory_xact_lock 用の固定キー。E2 ランキング同期専用であることが分かればよいので
// 値そのものに意味はない(他機能のロックキーと衝突しない値を適当に割り当てただけ)。
const RANKING_SYNC_LOCK_KEY = 861025;

/** 順位表を使うイベントタイプ（EventDashboard の isRankingType と同じ・定義は auto-ranking-type.ts） */
const RANKING_EVENT_TYPES: ReadonlySet<string> = new Set(RANKING_EVENT_TYPE_LIST);

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

  // 日替わり（デイリー）のシミュレーターの期間を、日が変わっていれば今日の 0:00〜翌 0:00 JST へ進める（2026-10-07 社長指示
  // 「1 日ごとに区切って開始終了を自動設定」）。区分の自動設定と順位の同期より前に行い、進めた行を同じ回で同期する。失敗しても続ける
  try {
    const roll = await rollDailySimulators(db, new Date());
    if (roll.rolled.length > 0) {
      console.log(`[ranking-sync/scheduled] daily roll: ${roll.rolled.map((r) => `${r.id.slice(0, 8)}:${r.start.toISOString()}~${r.end.toISOString()}`).join(",")}`);
    }
  } catch (e) {
    console.warn("[ranking-sync/scheduled] daily roll failed", describeDbError(e));
  }

  // 区分（ranking_type）が空のシミュレーターに既定の区分を入れる（2026-10-01 社長指示「今後自動で取ってくるように」）。
  // 区分の構造が保存されていないイベントは先に取り直す。ここが失敗しても順位の同期は続ける（トランザクションの外で行う）
  try {
    const auto = await autoAssignRankingTypes(db, new Date());
    if (auto.assigned.length > 0 || auto.repaired.length > 0) {
      console.log(`[ranking-sync/scheduled] auto ranking_type assigned=${auto.assigned.map((a) => `${a.id.slice(0, 8)}:${a.rankingType}`).join(",") || "-"} repaired=${auto.repaired.join(",") || "-"}`);
    }
    if (auto.skipped.length > 0) {
      console.warn(`[ranking-sync/scheduled] auto ranking_type skipped=${auto.skipped.map((s) => `${s.id.slice(0, 8)}:${s.reason}`).join(",")}`);
    }
  } catch (e) {
    console.warn("[ranking-sync/scheduled] auto ranking_type failed", describeDbError(e));
  }

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
    const inPeriod = await tx
      .select()
      .from(eventSimulators)
      .where(and(eq(eventSimulators.status, "active"), lte(eventSimulators.startTime, now), gte(eventSimulators.endTime, now)));
    // 同期の対象は ranking_type（ランキング区分）があるものだけ。区分が空のランキング型のふわっちイベントは
    // 対象外になって書き込みが黙って止まる（2026-09-30 オオカミさんがやってくる！で実害: 区分の取得不具合 PR #50 の
    // 6 分前に作ったため空のまま保存され、5 分同期が targets=0 のまま）。件数と id をログに出して気づけるようにする
    const targets = inPeriod.filter((ev) => Boolean(ev.rankingType));
    const noRankingType = inPeriod.filter((ev) => !ev.rankingType && ev.platform === "whowatch" && RANKING_EVENT_TYPES.has(ev.eventType));
    if (noRankingType.length > 0) {
      console.warn(
        `[ranking-sync/scheduled] ranking_type が空のため対象外: ${noRankingType.map((ev) => ev.id.slice(0, 8)).join(",")}（自動設定できなかったもの。理由は auto ranking_type skipped のログ。イベントの「区分・期間を編集」で区分を選ぶと対象になる）`,
      );
    }

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
    console.log(`[ranking-sync/scheduled] targets=${targets.length} ok=${ok} failed=${failed} no_ranking_type=${noRankingType.length}`);
  });
}

export default {
  fetch: handler.fetch,
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runRankingSync(env as Record<string, unknown>));
  },
} satisfies ExportedHandler<Record<string, unknown>>;
