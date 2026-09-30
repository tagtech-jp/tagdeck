import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { seMappings } from "@/lib/db/schema";
import { planOwnCc0Conversion } from "@/lib/se/cleared-defaults";

// 自分の SE 割り当てを CC0 の音だけにする（2026-09-30 社長指示「社長の環境にも新音源を全て同期して著作権回避と商用利用可能なものだけにする」・S24）。
// 対象は呼び出した本人の se_mappings だけ。アップロードした音の行は CC0 の同種の音（公式既定と同じ /se/defaults/cc0/）に置き換え、
// 価格帯・廃止キー・種類の分からない音の行は外す（自動ライブラリの CC0 の音が鳴る）。Storage のファイルそのものは消さない。
//   GET  → 計画だけ返す（書き換えない）
//   POST → 書き換える。応答の before は書き換える前の行（戻すときの控え）

async function loadOwnRows() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const db = createDbClient();
  const rows = await db.select().from(seMappings).where(eq(seMappings.userId, user.id));
  return { db, userId: user.id, rows };
}

const toBefore = (r: typeof seMappings.$inferSelect) => ({ key: r.key, url: r.url, volume: r.volume, enabled: r.enabled, label: r.label, updatedAt: r.updatedAt.toISOString() });

export async function GET() {
  const own = await loadOwnRows();
  if (!own) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const plan = planOwnCc0Conversion(own.rows);
  const res = NextResponse.json({ dryRun: true, plan, counts: { updates: plan.updates.length, deletes: plan.deletes.length, kept: plan.kept.length } });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export async function POST() {
  const own = await loadOwnRows();
  if (!own) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db, userId, rows } = own;
  const plan = planOwnCc0Conversion(rows);
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const u of plan.updates) {
      await tx.update(seMappings).set({ url: u.url, label: u.label, volume: u.volume, updatedAt: now }).where(and(eq(seMappings.userId, userId), eq(seMappings.key, u.key)));
    }
    if (plan.deletes.length > 0) {
      await tx.delete(seMappings).where(and(eq(seMappings.userId, userId), inArray(seMappings.key, plan.deletes.map((d) => d.key))));
    }
  });
  const res = NextResponse.json({ dryRun: false, counts: { updated: plan.updates.length, deleted: plan.deletes.length, kept: plan.kept.length }, plan, before: rows.map(toBefore) });
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}
