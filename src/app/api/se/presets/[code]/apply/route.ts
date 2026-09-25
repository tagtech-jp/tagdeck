import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { ensureUserRow } from "@/lib/db/ensure-user";
import { normalizeShareCode, toPresetMappings } from "@/lib/se/presets";
import { allowedSoundHost, applyPresetToUser, findPresetByCode, describePresetDbError } from "@/lib/se/presets-db";

// S2: プリセットを自分の SE 割り当てに取り込む。
//   replace = 自分の割り当てを全部消してからプリセットの内容にする
//   merge   = プリセットにある key だけ上書きし、無い key は今のまま残す

const bodySchema = z.object({ mode: z.enum(["replace", "merge"]).default("merge") });

/** POST /api/se/presets/[code]/apply {mode} */
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const code = normalizeShareCode((await params).code);
  if (!code) return NextResponse.json({ error: "共有コードの書式が違います（英数字 8 文字）" }, { status: 400 });
  const parsed = bodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "mode は replace か merge" }, { status: 400 });
  try {
    const db = createDbClient();
    const found = await findPresetByCode(db, code);
    if (!found) return NextResponse.json({ error: "その共有コードのプリセットは見つかりません" }, { status: 404 });
    const mappings = toPresetMappings(found.row.mappings, { allowedHost: allowedSoundHost() });
    await ensureUserRow(db, user);
    const result = await applyPresetToUser(db, user.id, mappings, parsed.data.mode);
    return NextResponse.json({ ok: true, mode: parsed.data.mode, ...result, preset: { name: found.row.name, shareCode: found.row.shareCode } });
  } catch (err) {
    const r = describePresetDbError(err);
    console.error("[se/presets] POST", r.error);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}
