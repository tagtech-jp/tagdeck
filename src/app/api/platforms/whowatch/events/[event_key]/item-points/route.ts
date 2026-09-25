import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventItemPoints } from "@/lib/db/schema";

const EVENT_KEY_RE = /^[a-z0-9_\-]{1,100}$/i;

/** GET /api/platforms/whowatch/events/{event_key}/item-points → そのイベントのアイテム基礎 pt 一覧（E3） */
export async function GET(_request: Request, { params }: { params: Promise<{ event_key: string }> }) {
  const { event_key: eventKey } = await params;
  if (!EVENT_KEY_RE.test(eventKey)) return NextResponse.json({ error: "invalid event_key" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createDbClient();
  const rows = await db.select().from(eventItemPoints).where(eq(eventItemPoints.eventKey, eventKey));
  return NextResponse.json({
    eventKey,
    items: rows.map((r) => ({ itemId: r.itemId, basePoint: r.basePoint, source: r.source, updatedAt: r.updatedAt.toISOString() })),
  });
}

const putSchema = z.object({
  itemId: z.string().min(1).max(100),
  basePoint: z.number().int().positive().max(1_000_000),
  source: z.enum(["manual", "estimated"]).default("manual"),
});

/** PUT → 1 アイテムの基礎 pt を upsert（全ユーザー共有の基準値。手入力欄から呼ぶ） */
export async function PUT(request: Request, { params }: { params: Promise<{ event_key: string }> }) {
  const { event_key: eventKey } = await params;
  if (!EVENT_KEY_RE.test(eventKey)) return NextResponse.json({ error: "invalid event_key" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "itemId と 1 以上の basePoint を指定してください" }, { status: 400 });
  const { itemId, basePoint, source } = parsed.data;

  const db = createDbClient();
  const now = new Date();
  const [row] = await db
    .insert(eventItemPoints)
    .values({ eventKey, itemId, basePoint, source, updatedAt: now })
    .onConflictDoUpdate({
      target: [eventItemPoints.eventKey, eventItemPoints.itemId],
      set: { basePoint: sql`excluded.base_point`, source: sql`excluded.source`, updatedAt: now },
    })
    .returning();
  return NextResponse.json({ item: { itemId: row.itemId, basePoint: row.basePoint, source: row.source, updatedAt: row.updatedAt.toISOString() } });
}

/** DELETE?itemId= → 1 件削除（誤入力の取り消し用） */
export async function DELETE(request: Request, { params }: { params: Promise<{ event_key: string }> }) {
  const { event_key: eventKey } = await params;
  if (!EVENT_KEY_RE.test(eventKey)) return NextResponse.json({ error: "invalid event_key" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const itemId = new URL(request.url).searchParams.get("itemId") ?? "";
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });
  const db = createDbClient();
  const deleted = await db
    .delete(eventItemPoints)
    .where(and(eq(eventItemPoints.eventKey, eventKey), eq(eventItemPoints.itemId, itemId)))
    .returning({ id: eventItemPoints.id });
  return NextResponse.json({ deleted: deleted.length });
}
