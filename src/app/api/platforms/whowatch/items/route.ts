import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { itemPointMapping } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { WHOWATCH_ITEMS, WHOWATCH_MULTIPLIERS } from "@/lib/platforms/whowatch/item-mapping";

// priceJpy はDB同期(sync_items_and_events.py)がbase_pointと同じ生price値を代入している
// ため現状ほぼ同値だが、将来乖離した場合に備えクライアント側の効率計算(strategy.ts)で
// 独立して参照できるよう返す。ハードコードフォールバックにはyen価格が無いため0とする。
const FALLBACK = WHOWATCH_ITEMS.map((i) => ({ id: i.id, name: i.name, basePoint: i.basePoint, priceJpy: 0 }));

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const db = createDbClient();
    const rows = await db
      .select({
        id: itemPointMapping.itemId,
        name: itemPointMapping.itemName,
        basePoint: itemPointMapping.basePoint,
        priceJpy: itemPointMapping.priceJpy,
      })
      .from(itemPointMapping)
      .where(eq(itemPointMapping.platform, "whowatch"));

    const source = rows.length > 0 ? "db" : "fallback";
    const items = rows.length > 0 ? rows : FALLBACK;
    const response = NextResponse.json({ items, multipliers: [...WHOWATCH_MULTIPLIERS], source });
    response.headers.set("Cache-Control", "public, max-age=86400");
    return response;
  } catch (err) {
    console.error("[whowatch/items] db error, using hardcoded fallback:", err);
    const response = NextResponse.json({ items: FALLBACK, multipliers: [...WHOWATCH_MULTIPLIERS], source: "fallback" });
    response.headers.set("Cache-Control", "public, max-age=86400");
    return response;
  }
}
