import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { itemPointMapping, whowatchItemDecorations, whowatchItemGroups, whowatchItemPatterns, whowatchItemPrices } from "@/lib/db/schema";
import { parseDecorations, type BulkDecoration } from "@/lib/se/bulk-grade";
import { pickItemImage } from "@/lib/se/item-image";

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
 *
 * 2026-09-25: アイテム画像を出すため、パターンごとではなく **アイテムごとに 1 枚だけ** imageUrl を返す
 * （pickItemImage）。約 1,970 件 × URL 1 本なので、パターン全件を返していた頃の 1/2 以下で済む
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
          // アイテム代表画像の選定用（応答にはアイテムごとに 1 枚だけ載せる）
          imageUrl: whowatchItemPatterns.imageUrl,
          syncedAt: whowatchItemPatterns.syncedAt,
        })
        .from(whowatchItemPatterns),
      db.select({ itemId: itemPointMapping.itemId, priceJpy: itemPointMapping.priceJpy, state: itemPointMapping.state }).from(itemPointMapping).where(eq(itemPointMapping.platform, "whowatch")),
    ]);
    const priceById = new Map(prices.map((p) => [p.itemId, p]));
    // パックにしか入っていないアイテム（2026-09-30）の価格の元。SE タブに「パック換算」と出す
    const priceNoteById = new Map<number, string>();
    // 1 個あたりの単価（whowatch_item_prices・2026-09-26）で上書き。0020 未適用・未同期なら従来の price_jpy のまま
    try {
      const unit = await db.select({ itemId: whowatchItemPrices.itemId, unitPriceJpy: whowatchItemPrices.unitPriceJpy, onSale: whowatchItemPrices.onSale, products: whowatchItemPrices.products }).from(whowatchItemPrices);
      for (const u of unit) {
        priceById.set(String(u.itemId), { itemId: String(u.itemId), priceJpy: u.unitPriceJpy, state: u.onSale ? "OPEN" : "CLOSED" });
        const pack = Array.isArray(u.products) ? u.products.find((p) => p?.pack)?.pack : undefined;
        if (pack) priceNoteById.set(u.itemId, `パック換算: ${pack.name} ¥${Math.round(pack.listPrice).toLocaleString()} ÷ ${pack.pieces} 個`);
      }
    } catch (e) {
      console.warn("[items/patterns] 単価テーブルが読めないため price_jpy を使う", e instanceof Error ? e.message : String(e));
    }

    // まとめ投げの段階しきい値（0022・2026-09-28）。テーブル未作成・未同期なら空（段階なし＝従来どおり）
    const decorationsByItem = new Map<number, BulkDecoration[]>();
    try {
      const rows = await db.select({ itemId: whowatchItemDecorations.itemId, decorations: whowatchItemDecorations.decorations }).from(whowatchItemDecorations);
      for (const r of rows) {
        const d = parseDecorations(r.decorations);
        if (d.length > 0) decorationsByItem.set(r.itemId, d);
      }
    } catch (e) {
      console.warn("[items/patterns] しきい値テーブルが読めないため段階なしで返す", e instanceof Error ? e.message : String(e));
    }

    // カテゴリは付加情報。ここで落ちてもアイテム一覧は返す（/live の SE 判定を道連れにしない）
    let groupRows: Array<{ itemId: number; groupKey: string; groupTitle: string; subGroupTitle: string | null; badgeText: string | null; displayOrder: number | null; bannerUrl: string | null; description: string | null; isFree: boolean }> = [];
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
          // 0021: イベントの無料配布（/live の SE を 3 個以上のまとめ投げだけにする判定に使う・2026-10-05）
          isFree: whowatchItemGroups.isFree,
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
    // イベントの無料配布アイテム（どれか 1 つのカテゴリで is_free なら無料扱い）
    const freeEventItems = new Set(groupRows.filter((g) => g.isFree).map((g) => g.itemId));
    // プルダウン用の一覧
    const groupMap = new Map<string, { groupKey: string; groupTitle: string; subGroupTitle: string | null; badgeText: string | null; displayOrder: number | null; bannerUrl: string | null; description: string | null; itemCount: number }>();
    for (const g of groupRows) {
      const cur = groupMap.get(g.groupKey);
      if (cur) cur.itemCount++;
      else groupMap.set(g.groupKey, { groupKey: g.groupKey, groupTitle: g.groupTitle, subGroupTitle: g.subGroupTitle, badgeText: g.badgeText, displayOrder: g.displayOrder, bannerUrl: g.bannerUrl, description: g.description, itemCount: 1 });
    }
    const groups = [...groupMap.values()].sort((a, b) => (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999) || a.groupTitle.localeCompare(b.groupTitle, "ja"));

    const items = new Map<number, { itemId: number; itemName: string; priceJpy: number | null; priceNote: string | null; onSale: boolean; imageUrl: string | null; groups: string[]; freeEvent: boolean; decorations: BulkDecoration[]; patterns: Array<{ patternId: number; patternName: string; isHit: boolean; hitGrade: string | null; isVariant: boolean; quantity: number | null; animationUrl: string | null; animationFullscreen: boolean }> }>();
    // アイテムごとの代表画像を選ぶための一時保持（応答には載せない）
    const imageCandidates = new Map<number, Array<{ patternName: string; imageUrl: string | null; isHit: boolean }>>();
    for (const p of patterns) {
      let it = items.get(p.itemId);
      if (!it) {
        const pr = priceById.get(String(p.itemId));
        // 2026-09-28: item_point_mapping にイベントの無料配布（state=FREE・price 0）も入るようになった。SE タブの表示（「無料（イベント配布）」）と
        // T0 判定は「価格なし＝null」のままにする（0 を ¥0〜 と表示しない）
        it = { itemId: p.itemId, itemName: p.itemName, priceJpy: pr && pr.priceJpy > 0 && pr.state !== "FREE" ? pr.priceJpy : null, priceNote: priceNoteById.get(p.itemId) ?? null, onSale: pr?.state === "OPEN", imageUrl: null, groups: groupsByItem.get(p.itemId) ?? [], freeEvent: freeEventItems.has(p.itemId), decorations: decorationsByItem.get(p.itemId) ?? [], patterns: [] };
        items.set(p.itemId, it);
        imageCandidates.set(p.itemId, []);
      }
      it.patterns.push({ patternId: p.patternId, patternName: p.patternName, isHit: p.isHit, hitGrade: p.hitGrade, isVariant: p.isVariant, quantity: p.quantity, animationUrl: p.animationUrl, animationFullscreen: p.animationFullscreen });
      imageCandidates.get(p.itemId)!.push({ patternName: p.patternName, imageUrl: p.imageUrl, isHit: p.isHit });
    }
    for (const it of items.values()) it.imageUrl = pickItemImage(it.itemName, imageCandidates.get(it.itemId) ?? []);
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
