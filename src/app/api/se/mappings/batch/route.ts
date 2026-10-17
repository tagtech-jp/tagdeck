import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { seMappings } from "@/lib/db/schema";
import { ensureUserRow } from "@/lib/db/ensure-user";
import { BULK_KEY_RE_SOURCE } from "@/lib/se/bulk-grade";

// SE 割り当てのまとめて保存・削除（2026-10-17・音源フォルダの一括取り込み用。src/lib/se/pack-import.ts）。
// 1 回で最大 MAX_ROWS 行を 1 文の upsert / delete にする（アイテム約 1,900 件 × 5 本を 1 行ずつ PUT すると数十分かかるため）。
// key の形・url のホストの制約は /api/se/mappings の PUT と同じ。自分の行（auth.uid()）にしか触れない
const KEY_RE = new RegExp(`^(pattern:\\d{1,10}|item:\\d{1,10}|cat:kind:(normal|hit|anim)|cat:group:[A-Za-z0-9_#-]{1,64}|tier:(T0|T1|T2|T3|T4|hit)|${BULK_KEY_RE_SOURCE})(?:#[2-5])?$`);
const MAX_ROWS = 500;

const rowSchema = z.object({
  key: z.string().regex(KEY_RE),
  url: z.string().url().max(2000),
  volume: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
  label: z.string().max(100).nullable().optional(),
});
const putSchema = z.object({ rows: z.array(rowSchema).min(1).max(MAX_ROWS) });
const deleteSchema = z.object({ keys: z.array(z.string().regex(KEY_RE)).min(1).max(MAX_ROWS) });

/** PUT { rows: [{ key, url, volume?, enabled?, label? }] } → まとめて upsert（同じ key が重なれば後の行が勝つ） */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `rows は 1〜${MAX_ROWS} 件。key は pattern:{id} / item:{id} / bulk:{段階} / tier:{T0..T4|hit}、url は必須、volume は 0〜100` }, { status: 400 });
  const allowedHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null;
  if (allowedHost && parsed.data.rows.some((r) => new URL(r.url).host !== allowedHost)) {
    return NextResponse.json({ error: "音源 URL は Supabase Storage のみ許可" }, { status: 400 });
  }
  // 1 文の upsert で同じ key が 2 回出ると Postgres が拒む（ON CONFLICT DO UPDATE command cannot affect row a second time）ので、後の行で畳む
  const byKey = new Map<string, z.infer<typeof rowSchema>>();
  for (const r of parsed.data.rows) byKey.set(r.key, r);
  const now = new Date();
  const db = createDbClient();
  await ensureUserRow(db, user);
  const saved = await db
    .insert(seMappings)
    .values([...byKey.values()].map((r) => ({ userId: user.id, key: r.key, url: r.url, volume: r.volume ?? 80, enabled: r.enabled ?? true, label: r.label ?? null, updatedAt: now })))
    .onConflictDoUpdate({
      target: [seMappings.userId, seMappings.key],
      set: { url: sql`excluded.url`, volume: sql`excluded.volume`, enabled: sql`excluded.enabled`, label: sql`excluded.label`, updatedAt: now },
    })
    .returning();
  return NextResponse.json({ mappings: saved.map((r) => ({ key: r.key, url: r.url, volume: r.volume, enabled: r.enabled, label: r.label, updatedAt: r.updatedAt.toISOString() })) });
}

/** DELETE { keys: [...] } → まとめて削除（既定音に戻す）。取り込みの取り消し用 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `keys は 1〜${MAX_ROWS} 件` }, { status: 400 });
  const db = createDbClient();
  const deleted = await db
    .delete(seMappings)
    .where(and(eq(seMappings.userId, user.id), inArray(seMappings.key, [...new Set(parsed.data.keys)])))
    .returning({ key: seMappings.key });
  return NextResponse.json({ deleted: deleted.length });
}
