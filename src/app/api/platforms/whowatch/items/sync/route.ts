import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db/client";
import { syncItemPatterns } from "@/lib/whowatch/item-patterns-sync";
import { fetchPaymentCategories, syncItemGroups, type SyncItemGroupsResult } from "@/lib/whowatch/item-groups-sync";
import { syncItemPrices, type SyncItemPricesResult } from "@/lib/whowatch/item-prices";
import { syncFreeEventItems, type SyncFreeEventItemsResult } from "@/lib/whowatch/free-event-items";
import { verifySyncKey } from "@/lib/whowatch/sync-auth";
import { sendNotifyGw } from "@/lib/notify-gw";
import { findSyncRoute } from "@/lib/sync-routes";
import { describeDbError } from "@/lib/whowatch/sanitize";

const ROUTE_PATH = "/api/platforms/whowatch/items/sync";

/**
 * POST /api/platforms/whowatch/items/sync → /playitems のアイテムパターン（4,000 件超）を whowatch_item_patterns に同期する（S1）
 * - 認証: X-Sync-Key。middleware.ts が SYNC_ROUTES（src/lib/sync-routes.ts）を見てこのパスを素通しする。
 *   未設定・未指定・不一致は 401 JSON。このファイル自身が SYNC_ROUTES に登録されているかも確認する
 *   （本番で 307 になった原因: このパスが middleware の素通しリストに未登録だった。再発防止として
 *    参照元を SYNC_ROUTES 1 か所に統合した）
 * - 呼び出し元: daily-sync.yml（毎日）/ item-patterns-sync.yml（workflow_dispatch）。next_cursor が
 *   null になるまでループする（?cursor=、?limit=（1 リクエストのチャンク数）、?chunk_size= を受け付ける）
 * - 2026-09-22 本番障害: 400 行/チャンクの単一 INSERT が HTTP 502 で失敗（詳細は item-patterns-sync.ts 冒頭）。
 *   200 行/チャンクに半減し、1 リクエストのチャンク数も制限。1 チャンクの失敗は他チャンクを止めない
 */
export async function POST(request: Request) {
  const route = findSyncRoute(ROUTE_PATH);
  if (!route) return NextResponse.json({ error: `route not registered in SYNC_ROUTES: ${ROUTE_PATH}` }, { status: 500 });

  const auth = verifySyncKey(request.headers.get("x-sync-key"), process.env[route.envKey]);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const cursor = sp.get("cursor") || null;
  const limitRaw = Number(sp.get("limit") ?? "");
  const batchLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
  const chunkSizeRaw = Number(sp.get("chunk_size") ?? "");
  const chunkSize = Number.isFinite(chunkSizeRaw) && chunkSizeRaw > 0 ? chunkSizeRaw : undefined;

  const db = createDbClient();
  try {
    // カテゴリ（/playitems/payments3）は 100 行前後と小さいので、cursor ループの初回だけ同期する。
    // 失敗してもパターン同期は続ける（カテゴリはアイテムの仕分け用で、当たり判定には影響しない）
    // 何もしていない場合と成功を区別できるよう、結果は必ずレスポンスに載せる
    let groups: SyncItemGroupsResult | { error: string } | { skipped: string } = { skipped: "初回バッチ以外（cursor あり）のため実行していない" };
    // 単価（whowatch_item_prices・2026-09-26）も同じ payments3 の応答から同期する。0020 未適用なら error に出る
    let prices: SyncItemPricesResult | { error: string } | { skipped: string } = { skipped: "初回バッチ以外（cursor あり）のため実行していない" };
    // イベントの無料配布アイテムをイベントのカテゴリへ（0021）。単価同期の後（無料判定に単価テーブルを使う）
    let freeItems: SyncFreeEventItemsResult | { error: string } | { skipped: string } = { skipped: "初回バッチ以外（cursor あり）のため実行していない" };
    if (!cursor) {
      let categories: Awaited<ReturnType<typeof fetchPaymentCategories>> | null = null;
      try {
        categories = await fetchPaymentCategories();
        groups = await syncItemGroups(db, categories);
        console.log("[items/sync] カテゴリ同期", groups);
      } catch (e) {
        groups = { error: e instanceof Error ? e.message : String(e) };
        console.error("[items/sync] カテゴリ同期に失敗（パターン同期は続行）", groups.error);
      }
      if (categories) {
        try {
          prices = await syncItemPrices(db, categories);
          console.log("[items/sync] 単価同期", prices);
        } catch (e) {
          prices = { error: describeDbError(e) };
          console.error("[items/sync] 単価同期に失敗（パターン同期は続行）", prices.error);
        }
        try {
          freeItems = await syncFreeEventItems(db, categories);
          console.log("[items/sync] 無料イベントアイテム分類", freeItems);
        } catch (e) {
          freeItems = { error: describeDbError(e) };
          console.error("[items/sync] 無料イベントアイテム分類に失敗（パターン同期は続行）", freeItems.error);
        }
      }
    }

    const result = await syncItemPatterns(db, { cursor, batchLimit, chunkSize });

    if (result.failed > 0) {
      await sendNotifyGw({
        agent_id: "tagdeck",
        action: "whowatch_item_patterns_sync",
        severity: "WARN",
        result: "failure",
        summary: `ふわっちアイテムパターン同期: ${result.failed}/${result.processed} 件失敗`,
        fingerprint: `tagdeck:item_patterns_sync:${new Date().toISOString().slice(0, 10)}`,
        meta: { firstError: result.error, failedChunks: result.results.filter((r) => !r.ok).map((r) => ({ range: r.range, error: r.error })) },
      });
    }

    // result に ok / inserted / updated / failed / next_cursor が含まれる
    return NextResponse.json({ ...result, groups, prices, freeItems, at: new Date().toISOString() });
  } catch (err) {
    const message = describeDbError(err);
    console.error("[items/sync] failed", message);
    await sendNotifyGw({ agent_id: "tagdeck", action: "whowatch_item_patterns_sync", severity: "WARN", result: "failure", summary: `ふわっちアイテムパターン同期に失敗: ${message}` });
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
