import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { ensureUserRow } from "@/lib/db/ensure-user";
import { PRESET_DESCRIPTION_MAX, PRESET_NAME_MAX } from "@/lib/se/presets";
import { createPreset, listOwnPresets, listPublicPresets, snapshotOwnMappings, toPublicPreset, describePresetDbError } from "@/lib/se/presets-db";

// S2: SE プリセット。GET = 自分のプリセット + 公開プリセット、POST = 今の se_mappings を名前付きで保存（共有コード発行）

/** GET /api/se/presets → { mine: [...], public: [...] } */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = createDbClient();
    const [mine, pub] = await Promise.all([listOwnPresets(db, user.id), listPublicPresets(db, user.id)]);
    return NextResponse.json({ mine, public: pub });
  } catch (err) {
    const r = describePresetDbError(err);
    console.error("[se/presets] GET", r.error);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}

const postSchema = z.object({
  name: z.string().trim().min(1).max(PRESET_NAME_MAX),
  description: z.string().trim().max(PRESET_DESCRIPTION_MAX).nullable().optional(),
  isPublic: z.boolean().optional(),
});

/** POST /api/se/presets {name, description?, isPublic?} → 今の割り当てをスナップショットして保存 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `名前は 1〜${PRESET_NAME_MAX} 文字、説明は ${PRESET_DESCRIPTION_MAX} 文字以内` }, { status: 400 });
  try {
    const db = createDbClient();
    await ensureUserRow(db, user);
    const mappings = await snapshotOwnMappings(db, user.id);
    if (mappings.length === 0) return NextResponse.json({ error: "SE の割り当てがまだありません。先に音源や音量を設定してください" }, { status: 400 });
    const row = await createPreset(db, user.id, {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      isPublic: parsed.data.isPublic ?? false,
      mappings,
    });
    return NextResponse.json({ preset: toPublicPreset(row, null, user.id) });
  } catch (err) {
    const r = describePresetDbError(err);
    console.error("[se/presets] POST", r.error);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}
