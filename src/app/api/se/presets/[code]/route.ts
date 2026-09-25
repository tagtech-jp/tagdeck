import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { sePresets } from "@/lib/db/schema";
import { PRESET_DESCRIPTION_MAX, PRESET_NAME_MAX, normalizeShareCode, summarizeMappings, toPresetMappings } from "@/lib/se/presets";
import { allowedSoundHost, findPresetByCode, snapshotOwnMappings, toPublicPreset } from "@/lib/se/presets-db";

// S2: 共有コード 1 件の参照・更新・削除。参照はコードを知っているログインユーザーなら誰でも可（取り込み前の確認用）

type Ctx = { params: Promise<{ code: string }> };

/** GET /api/se/presets/[code] → プリセットの内容（割り当て一覧と内訳） */
export async function GET(_request: Request, { params }: Ctx) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const code = normalizeShareCode((await params).code);
  if (!code) return NextResponse.json({ error: "共有コードの書式が違います（英数字 8 文字）" }, { status: 400 });
  const db = createDbClient();
  const found = await findPresetByCode(db, code);
  if (!found) return NextResponse.json({ error: "その共有コードのプリセットは見つかりません" }, { status: 404 });
  const mappings = toPresetMappings(found.row.mappings, { allowedHost: allowedSoundHost() });
  return NextResponse.json({ preset: toPublicPreset(found.row, found.ownerName, user.id), mappings, summary: summarizeMappings(mappings) });
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(PRESET_NAME_MAX).optional(),
    description: z.string().trim().max(PRESET_DESCRIPTION_MAX).nullable().optional(),
    isPublic: z.boolean().optional(),
    /** true なら今の se_mappings で割り当てを取り直す */
    refresh: z.boolean().optional(),
  })
  .refine((d) => d.name !== undefined || d.description !== undefined || d.isPublic !== undefined || d.refresh, { message: "更新項目がありません" });

/** PATCH /api/se/presets/[code] → 所有者のみ。名前・説明・公開/非公開・割り当ての取り直し */
export async function PATCH(request: Request, { params }: Ctx) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const code = normalizeShareCode((await params).code);
  if (!code) return NextResponse.json({ error: "共有コードの書式が違います" }, { status: 400 });
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "name / description / isPublic / refresh のいずれかを指定してください" }, { status: 400 });
  const db = createDbClient();
  const found = await findPresetByCode(db, code);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (found.row.ownerUserId !== user.id) return NextResponse.json({ error: "自分のプリセットだけ変更できます" }, { status: 403 });
  const d = parsed.data;
  let refreshed: { mappings: ReturnType<typeof toPresetMappings>; mappingCount: number } | null = null;
  if (d.refresh) {
    const mappings = await snapshotOwnMappings(db, user.id);
    if (mappings.length === 0) return NextResponse.json({ error: "SE の割り当てがまだありません" }, { status: 400 });
    refreshed = { mappings, mappingCount: mappings.length };
  }
  const [row] = await db
    .update(sePresets)
    .set({
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.isPublic !== undefined ? { isPublic: d.isPublic } : {}),
      ...(refreshed ?? {}),
      updatedAt: new Date(),
    })
    .where(eq(sePresets.id, found.row.id))
    .returning();
  return NextResponse.json({ preset: toPublicPreset(row, null, user.id) });
}

/** DELETE /api/se/presets/[code] → 所有者のみ */
export async function DELETE(_request: Request, { params }: Ctx) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const code = normalizeShareCode((await params).code);
  if (!code) return NextResponse.json({ error: "共有コードの書式が違います" }, { status: 400 });
  const db = createDbClient();
  const found = await findPresetByCode(db, code);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (found.row.ownerUserId !== user.id) return NextResponse.json({ error: "自分のプリセットだけ削除できます" }, { status: 403 });
  await db.delete(sePresets).where(eq(sePresets.id, found.row.id));
  return NextResponse.json({ deleted: 1 });
}
