import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { seMappings } from "@/lib/db/schema";
import { ensureUserRow } from "@/lib/db/ensure-user";

// cat:kind = 種類の一括割り当て / cat:group = イベント別（第 2 弾）
const KEY_RE = /^(pattern:\d{1,10}|item:\d{1,10}|cat:kind:(normal|hit|anim)|cat:group:[A-Za-z0-9_#-]{1,64}|tier:(T0|T1|T2|T3|T4|hit))$/;

/**
 * GET /api/se/mappings → 自分の SE 割り当て一覧（S1）+ 公式既定（S4: 同期元ユーザーの現在の割り当て）
 * defaults: 環境変数 SE_DEFAULT_SOURCE_USER_ID（wrangler.jsonc の vars）で指定したユーザーの se_mappings のうち、
 *   音源あり・鳴らす ON の行。同期元がアップロードし直せば次の読込から全ユーザーの既定が変わる。
 *   未設定・0 件なら null（クライアントは同梱スナップショットに落ちる）
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createDbClient();
  const sourceId = (process.env.SE_DEFAULT_SOURCE_USER_ID ?? "").trim();
  const [rows, sourceRows] = await Promise.all([
    db.select().from(seMappings).where(eq(seMappings.userId, user.id)),
    sourceId ? db.select().from(seMappings).where(eq(seMappings.userId, sourceId)) : Promise.resolve([]),
  ]);
  const toRow = (r: typeof seMappings.$inferSelect) => ({ key: r.key, url: r.url, volume: r.volume, enabled: r.enabled, label: r.label, updatedAt: r.updatedAt.toISOString() });
  const defaults = sourceRows.filter((r) => r.enabled && r.url).map(toRow);
  const res = NextResponse.json({ mappings: rows.map(toRow), defaults: defaults.length > 0 ? defaults : null, defaultsSource: sourceId ? "sync" : "bundled" });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

const putSchema = z.object({
  key: z.string().regex(KEY_RE),
  url: z.string().url().max(2000).nullable().optional(),
  volume: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
  label: z.string().max(100).nullable().optional(),
});

/** PUT → upsert（url は Supabase Storage の公開 URL か null=既定合成音） */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "key は pattern:{id} / item:{id} / tier:{T0..T4|hit}、volume は 0〜100" }, { status: 400 });
  const d = parsed.data;
  if (d.url) {
    const allowedHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host : null;
    const host = new URL(d.url).host;
    if (allowedHost && host !== allowedHost) return NextResponse.json({ error: "音源 URL は Supabase Storage のみ許可" }, { status: 400 });
  }
  const db = createDbClient();
  await ensureUserRow(db, user);
  const now = new Date();
  const [row] = await db
    .insert(seMappings)
    .values({ userId: user.id, key: d.key, url: d.url ?? null, volume: d.volume ?? 80, enabled: d.enabled ?? true, label: d.label ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: [seMappings.userId, seMappings.key],
      set: {
        ...(d.url !== undefined ? { url: sql`excluded.url` } : {}),
        ...(d.volume !== undefined ? { volume: sql`excluded.volume` } : {}),
        ...(d.enabled !== undefined ? { enabled: sql`excluded.enabled` } : {}),
        ...(d.label !== undefined ? { label: sql`excluded.label` } : {}),
        updatedAt: now,
      },
    })
    .returning();
  return NextResponse.json({ mapping: { key: row.key, url: row.url, volume: row.volume, enabled: row.enabled, label: row.label, updatedAt: row.updatedAt.toISOString() } });
}

/** DELETE?key= → 1 件削除（既定音に戻す） */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "invalid key" }, { status: 400 });
  const db = createDbClient();
  const deleted = await db.delete(seMappings).where(and(eq(seMappings.userId, user.id), eq(seMappings.key, key))).returning({ id: seMappings.id });
  return NextResponse.json({ deleted: deleted.length });
}
