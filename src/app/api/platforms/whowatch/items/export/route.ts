import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { itemPointMapping, whowatchEvents, whowatchItemGroups } from "@/lib/db/schema";
import { findSyncRoute } from "@/lib/sync-routes";
import { verifySyncKey } from "@/lib/whowatch/sync-auth";
import { describeDbError } from "@/lib/whowatch/sanitize";
import { buildExportItems } from "@/lib/whowatch/item-export";
import { summarizeLearnedGaps } from "@/lib/whowatch/learned-gap";

const ROUTE_PATH = "/api/platforms/whowatch/items/export";

/**
 * GET /api/platforms/whowatch/items/export → item_point_mapping（platform=whowatch）を外部ツール向けに JSON で返す（2026-09-28）
 * - 用途: tagtech-OBS の単価表。従来は社長が Supabase から手で CSV 書き出ししていたため、イベント開始後に追加された
 *   アイテムが反映されなかった（社長報告「イベント限定アイテムが漏れている」）。OBS は起動時にここを取りに来る
 * - 認証: X-Sync-Key（他の同期ルートと同じ RANKING_SYNC_KEY・middleware は SYNC_ROUTES で素通し）。
 *   ヘッダが無ければログイン Cookie でも可（ブラウザでの確認用）。どちらも無ければ 401
 * - 読み取り専用。列の意味は src/lib/whowatch/item-export.ts
 * - 学習単価（learned_*・drizzle/0023・2026-10-04）は運営者の実際の収益の比率なので、X-Sync-Key（自前のツール）のときだけ付ける。
 *   ログイン Cookie（TagDeck の利用者なら誰でも）には付けない。0023 未適用で読めないときは付けずに返し、learned_error に理由を書く
 * - POST も同じ処理（sync-routes.test.ts の共通ループが POST で検証するため）
 */
async function authorize(request: Request): Promise<{ denied: NextResponse } | { via: "sync" | "cookie" }> {
  const route = findSyncRoute(ROUTE_PATH);
  if (!route) return { denied: NextResponse.json({ error: `route not registered in SYNC_ROUTES: ${ROUTE_PATH}` }, { status: 500 }) };
  const given = request.headers.get("x-sync-key");
  if (given !== null) {
    const auth = verifySyncKey(given, process.env[route.envKey]);
    return auth.ok ? { via: "sync" } : { denied: NextResponse.json({ error: auth.reason }, { status: 401 }) };
  }
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) return { via: "cookie" };
  } catch {
    // リクエスト外（テスト等）や Cookie 無しは未認証扱い
  }
  return { denied: NextResponse.json({ error: "missing X-Sync-Key (or login)" }, { status: 401 }) };
}

async function handle(request: Request): Promise<NextResponse> {
  const auth = await authorize(request);
  if ("denied" in auth) return auth.denied;
  const includeLearned = auth.via === "sync";
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
    // 学習単価も付加情報。0023 未適用などで読めなくてもアイテム一覧は返す
    let mapped = Array.isArray(rows) ? rows : [];
    let learnedError: string | null = null;
    if (includeLearned) {
      try {
        const learned = new Map((await loadLearned(db)).map((l) => [l.itemId, l]));
        mapped = mapped.map((r) => {
          const l = learned.get(r.itemId);
          return l ? { ...r, learnedPoint: l.learnedPoint, learnedSamples: l.learnedSamples, learnedAt: l.learnedAt } : r;
        });
      } catch (e) {
        learnedError = describeDbError(e);
        console.warn("[items/export] 学習単価の取得に失敗（学習単価なしで返す・0023 未適用？）", learnedError);
      }
    }
    const items = buildExportItems(mapped, groups, events, { includeLearned: includeLearned && learnedError === null });
    const res = NextResponse.json({
      exported_at: new Date().toISOString(),
      source: "item_point_mapping",
      price_definition: "price_jpy = 1 個あたりの定価（円・まとめ買い割引前）。state=FREE は無料配布（0 円）",
      ...(includeLearned
        ? {
            learned_definition: "learned_point = 配信者が実際に受け取った 1 個あたりのポイント（/present の増え方から学習・観測の中央値）。learned_samples = 観測回数。未学習は null / 0",
            ...(learnedError
              ? { learned_error: learnedError }
              : {
                  // 学習単価と定価の答え合わせ（2026-10-05）。ポイント÷円 の中央値から 2 割以上ずれたアイテム
                  learned_gaps_definition: "learned_gaps = learned_point ÷ price_jpy が全体の中央値から threshold_pct% 以上ずれたアイテム（観測 min_samples 回以上）。higher/lower = 見込み expected_point より多い/少ない（イベント倍率・定価の誤り・学習の誤りを疑う）。free_with_points = 無料なのにポイントが付く",
                  learned_gaps: summarizeLearnedGaps(items),
                }),
          }
        : {}),
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
async function loadLearned(db: ReturnType<typeof createDbClient>) {
  const rows = await db
    .select({ itemId: itemPointMapping.itemId, learnedPoint: itemPointMapping.learnedPoint, learnedSamples: itemPointMapping.learnedSamples, learnedAt: itemPointMapping.learnedAt })
    .from(itemPointMapping)
    .where(and(eq(itemPointMapping.platform, "whowatch"), isNotNull(itemPointMapping.learnedPoint)));
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
