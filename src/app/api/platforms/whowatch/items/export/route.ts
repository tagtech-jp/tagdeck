import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { itemPointMapping, whowatchEvents, whowatchItemGroups } from "@/lib/db/schema";
import { findSyncRoute } from "@/lib/sync-routes";
import { verifySyncKey } from "@/lib/whowatch/sync-auth";
import { describeDbError } from "@/lib/whowatch/sanitize";
import { buildExportItems } from "@/lib/whowatch/item-export";

const ROUTE_PATH = "/api/platforms/whowatch/items/export";

/**
 * GET /api/platforms/whowatch/items/export → item_point_mapping（platform=whowatch）を外部ツール向けに JSON で返す（2026-09-28）
 * - 用途: tagtech-OBS の単価表。従来は社長が Supabase から手で CSV 書き出ししていたため、イベント開始後に追加された
 *   アイテムが反映されなかった（社長報告「イベント限定アイテムが漏れている」）。OBS は起動時にここを取りに来る
 * - 認証: X-Sync-Key（他の同期ルートと同じ RANKING_SYNC_KEY・middleware は SYNC_ROUTES で素通し）。
 *   ヘッダが無ければログイン Cookie でも可（ブラウザでの確認用）。どちらも無ければ 401
 * - 読み取り専用。列の意味は src/lib/whowatch/item-export.ts
 * - POST も同じ処理（sync-routes.test.ts の共通ループが POST で検証するため）
 */
async function authorize(request: Request): Promise<NextResponse | null> {
  const route = findSyncRoute(ROUTE_PATH);
  if (!route) return NextResponse.json({ error: `route not registered in SYNC_ROUTES: ${ROUTE_PATH}` }, { status: 500 });
  const given = request.headers.get("x-sync-key");
  if (given !== null) {
    const auth = verifySyncKey(given, process.env[route.envKey]);
    return auth.ok ? null : NextResponse.json({ error: auth.reason }, { status: 401 });
  }
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return null;
  } catch {
    // リクエスト外（テスト等）や Cookie 無しは未認証扱い
  }
  return NextResponse.json({ error: "missing X-Sync-Key (or login)" }, { status: 401 });
}

async function handle(request: Request): Promise<NextResponse> {
  const denied = await authorize(request);
  if (denied) return denied;
  const db = createDbClient();
  try {
    const rows = await db
      .select({ itemId: itemPointMapping.itemId, itemName: itemPointMapping.itemName, priceJpy: itemPointMapping.priceJpy, productId: itemPointMapping.productId, state: itemPointMapping.state, whowatchId: itemPointMapping.whowatchId, lastFetchedAt: itemPointMapping.lastFetchedAt })
      .from(itemPointMapping)
      .where(eq(itemPointMapping.platform, "whowatch"));
    // カテゴリ・イベントは付加情報。読めなくてもアイテム一覧は返す
    let groups: Awaited<ReturnType<typeof loadGroups>> = [];
    let events: Awaited<ReturnType<typeof loadEvents>> = [];
    try {
      [groups, events] = await Promise.all([loadGroups(db), loadEvents(db)]);
    } catch (e) {
      console.warn("[items/export] カテゴリ・イベントの取得に失敗（イベント無しで返す）", describeDbError(e));
    }
    const items = buildExportItems(Array.isArray(rows) ? rows : [], groups, events);
    const res = NextResponse.json({
      exported_at: new Date().toISOString(),
      source: "item_point_mapping",
      price_definition: "price_jpy = 1 個あたりの定価（円・まとめ買い割引前）。state=FREE は無料配布（0 円）",
      count: items.length,
      items,
    });
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e) {
    const message = describeDbError(e);
    console.error("[items/export] 失敗", message);
    return NextResponse.json({ error: "単価表を取得できませんでした", detail: message }, { status: 500 });
  }
}

async function loadGroups(db: ReturnType<typeof createDbClient>) {
  const rows = await db.select({ itemId: whowatchItemGroups.itemId, groupKey: whowatchItemGroups.groupKey, eventKey: whowatchItemGroups.eventKey, isFree: whowatchItemGroups.isFree, displayOrder: whowatchItemGroups.displayOrder }).from(whowatchItemGroups);
  return Array.isArray(rows) ? rows : [];
}
async function loadEvents(db: ReturnType<typeof createDbClient>) {
  const rows = await db.select({ id: whowatchEvents.id, eventKey: whowatchEvents.eventKey, itemGroupKey: whowatchEvents.itemGroupKey, status: whowatchEvents.status }).from(whowatchEvents);
  return Array.isArray(rows) ? rows : [];
}

export async function GET(request: Request) {
  return handle(request);
}
export async function POST(request: Request) {
  return handle(request);
}
