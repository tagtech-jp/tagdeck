import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { ensureUserRow } from "@/lib/db/ensure-user";
import { seMappings } from "@/lib/db/schema";
import { summarizeMappings, toPresetMappings } from "@/lib/se/presets";
import { allowedSoundHost, applyPresetToUser, describePresetDbError } from "@/lib/se/presets-db";

// 公式の既定 SE（運営アカウント = SE_DEFAULT_SOURCE_USER_ID の現在の割り当て）を、共有コード無しで自分の設定として取り込む（2026-09-26 社長指示）。
// 既定は何もしなくても再生に使われるが、取り込むと自分の行になるので、以後運営が差し替えても自分の設定は変わらない（固定したい人向け）。

async function loadOfficialMappings() {
  const sourceId = (process.env.SE_DEFAULT_SOURCE_USER_ID ?? "").trim();
  if (!sourceId) return null;
  const db = createDbClient();
  const rows = await db
    .select({ key: seMappings.key, url: seMappings.url, volume: seMappings.volume, enabled: seMappings.enabled, label: seMappings.label })
    .from(seMappings)
    .where(eq(seMappings.userId, sourceId));
  return { db, mappings: toPresetMappings(rows.filter((r) => r.enabled && r.url), { allowedHost: allowedSoundHost() }) };
}

/** GET /api/se/presets/default → 公式既定の件数と内訳（取り込み前の確認用） */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const loaded = await loadOfficialMappings();
    if (!loaded || loaded.mappings.length === 0) return NextResponse.json({ available: false, summary: null });
    return NextResponse.json({ available: true, summary: summarizeMappings(loaded.mappings) });
  } catch (err) {
    const r = describePresetDbError(err);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}

const bodySchema = z.object({ mode: z.enum(["replace", "merge"]).default("merge") });

/** POST /api/se/presets/default {mode} → 公式既定を自分の se_mappings に取り込む（コード不要） */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse((await request.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: "mode は replace か merge" }, { status: 400 });
  try {
    const loaded = await loadOfficialMappings();
    if (!loaded || loaded.mappings.length === 0) return NextResponse.json({ error: "公式の既定 SE が設定されていません" }, { status: 404 });
    await ensureUserRow(loaded.db, user);
    const result = await applyPresetToUser(loaded.db, user.id, loaded.mappings, parsed.data.mode);
    return NextResponse.json({ ok: true, mode: parsed.data.mode, ...result });
  } catch (err) {
    const r = describePresetDbError(err);
    console.error("[se/presets/default] POST", r.error);
    return NextResponse.json({ error: r.error }, { status: r.status });
  }
}
