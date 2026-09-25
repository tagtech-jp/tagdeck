import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { itemPointMapping, whowatchItemGroups, whowatchItemPatterns } from "@/lib/db/schema";

/**
 * GET /api/platforms/whowatch/items/patterns → SE タブ用アイテム一覧（S1）
 * whowatch_item_patterns（/playitems）× item_point_mapping（/playitems/payments3 の価格）を item_id で結合し、アイテム単位に束ねて返す。
 * 価格が無いアイテム（無料・販売終了・イベント限定）は priceJpy=null。
 *
 * 2026-09-22 本番障害: このルートが HTTP 500 を返し、/live のパターン照合マスタが取得できず
 * 全ギフトが無料扱いの音になった。対策として以下を入れている。
 * - 例外を握りつぶさず、メッセージとスタックをログに出す（何が起きたか分からない状態を作らない）
 * - カテゴリ（whowatch_item_groups）の取得失敗でアイテム一覧を道連れにしない。
 *   カテゴリは仕分け用の付加情報で、SE の当たり判定には要らない
 * - 応答から誰も使っていない imageUrl / soundUrl を外す。4,431 パターン分の URL 文字列で
 *   応答が 1.35MB あり、Workers の CPU 時間（AGENTS.md: Free プラン 10ms/request）に対して重すぎた
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createDbClient();
  try {
    // 必要な列だけ選ぶ（image_url / sound_url は誰も使っていないので載せない）
    const [patterns, prices] = await Promise.all([
      db
        .select({
          patternId: whowatchItemPatterns.patternId,
          itemId: whowatchItemPatterns.itemId,
          itemName: whowatchItemPatterns.itemName,
          patternName: whowatchItemPatterns.patternName,
          quantity: whowatchItemPatterns.quantity,
          isHit: whowatchItemPatterns.isHit,
          hitGrade: whowatchItemPatterns.hitGrade,
          isVariant: whowatchItemPatterns.isVariant,
          animationUrl: whowatchItemPatterns.animationUrl,
          animationFullscreen: whowatchItemPatterns.animationFullscreen,
          syncedAt: whowatchItemPatterns.syncedAt,
        })
        .from(whowatchItemPatterns),
      db.select({ itemId: itemPointMapping.itemId, priceJpy: itemPointMapping.priceJpy, state: itemPointMapping.state }).from(itemPointMapping).where(eq(itemPointMapping.platform, "whowatch")),
    ]);
    const priceById = new Map(prices.map((p) => [p.itemId, p]));

    // カテゴリは付加情報。ここで落ちてもアイテム一覧は返す（/live の SE 判定を道連れにしない）
    let groupRows: Array<{ itemId: number; groupKey: string; groupTitle: string; subGroupTitle: string | null; badgeText: string | null; displayOrder: number | null; bannerUrl: string | null; description: string | null }> = [];
    try {
      groupRows = await db
        .select({
          itemId: whowatchItemGroups.itemId,
          groupKey: whowatchItemGroups.groupKey,
          groupTitle: whowatchItemGroups.groupTitle,
          subGroupTitle: whowatchItemGroups.subGroupTitle,
          badgeText: whowatchItemGroups.badgeText,
          displayOrder: whowatchItemGroups.displayOrder,
          // 0017: バナー画像と説明文（SE タブのセクション見出し用。無ければ null）
          bannerUrl: whowatchItemGroups.bannerUrl,
          description: whowatchItemGroups.description,
        })
        .from(whowatchItemGroups);
    } catch (e) {
      console.error("[items/patterns] カテゴリ取得に失敗（アイテム一覧は返す）", { message: e instanceof Error ? e.message : String(e) });
    }

    // 1 アイテムが複数カテゴリに属するため配列で持つ。並びはアイテムページの display_order 順
    const groupsByItem = new Map<number, string[]>();
    for (const g of [...groupRows].sort((a, b) => (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999))) {
      const list = groupsByItem.get(g.itemId);
      if (list) list.push(g.groupKey);
      else groupsByItem.set(g.itemId, [g.groupKey]);
    }
    // プルダウン用の一覧
    const groupMap = new Map<string, { groupKey: string; groupTitle: string; subGroupTitle: string | null; badgeText: string | null; displayOrder: number | null; bannerUrl: string | null; description: string | null; itemCount: number }>();
    for (const g of groupRows) {
      const cur = groupMap.get(g.groupKey);
      if (cur) cur.itemCount++;
      else groupMap.set(g.groupKey, { groupKey: g.groupKey, groupTitle: g.groupTitle, subGroupTitle: g.subGroupTitle, badgeText: g.badgeText, displayOrder: g.displayOrder, bannerUrl: g.bannerUrl, description: g.description, itemCount: 1 });
    }
    const groups = [...groupMap.values()].sort((a, b) => (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999) || a.groupTitle.localeCompare(b.groupTitle, "ja"));

    const items = new Map<number, { itemId: number; itemName: string; priceJpy: number | null; onSale: boolean; groups: string[]; patterns: Array<{ patternId: number; patternName: string; isHit: boolean; hitGrade: string | null; isVariant: boolean; quantity: number | null; animationUrl: string | null; animationFullscreen: boolean }> }>();
    for (const p of patterns) {
      let it = items.get(p.itemId);
      if (!it) {
        const pr = priceById.get(String(p.itemId));
        it = { itemId: p.itemId, itemName: p.itemName, priceJpy: pr ? pr.priceJpy : null, onSale: pr?.state === "OPEN", groups: groupsByItem.get(p.itemId) ?? [], patterns: [] };
        items.set(p.itemId, it);
      }
      it.patterns.push({ patternId: p.patternId, patternName: p.patternName, isHit: p.isHit, hitGrade: p.hitGrade, isVariant: p.isVariant, quantity: p.quantity, animationUrl: p.animationUrl, animationFullscreen: p.animationFullscreen });
    }
    // 販売中（価格あり）→ 名前順に並べ、無料・非販売は後ろ
    const list = [...items.values()].sort((a, b) => Number(b.priceJpy !== null) - Number(a.priceJpy !== null) || (b.priceJpy ?? 0) - (a.priceJpy ?? 0) || a.itemName.localeCompare(b.itemName, "ja"));
    const res = NextResponse.json({ items: list, groups, patternCount: patterns.length, syncedAt: patterns[0]?.syncedAt?.toISOString() ?? null });
    res.headers.set("Cache-Control", "private, max-age=300");
    return res;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[items/patterns] 失敗", { message, stack: e instanceof Error ? e.stack : undefined });
    return NextResponse.json({ error: "アイテムマスタを取得できませんでした", detail: message }, { status: 500 });
  }
}
