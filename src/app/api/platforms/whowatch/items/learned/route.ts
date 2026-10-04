import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { createDbClient } from "@/lib/db/client";
import { findSyncRoute } from "@/lib/sync-routes";
import { verifySyncKey } from "@/lib/whowatch/sync-auth";
import { describeDbError } from "@/lib/whowatch/sanitize";
import { parseLearnedBody, summarizeUpdate, toRecordsetJson, type UpdatedRow } from "@/lib/whowatch/learned-points";

const ROUTE_PATH = "/api/platforms/whowatch/items/learned";

/**
 * POST /api/platforms/whowatch/items/learned → item_point_mapping の学習単価（learned_point / learned_samples / learned_at）を書く（外部連携・2026-10-04）
 * - 呼び出し元: erupi-commentbot（社長の PC で常駐）。/present から単価を学習するたびに、学習済みの全アイテムを送る（何度送っても同じ結果）
 * - 認証: X-Sync-Key（RANKING_SYNC_KEY・SYNC_ROUTES に登録）。ログイン Cookie では書けない
 * - 更新するのは learned_* の 3 列だけで、行は作らない（単価表に無い item_id は missing で返す）。
 *   数値の item_id の行と、同じ数値を whowatch_id に持つ旧シード行の両方を更新する（items/export はどちらか 1 行を出すため）
 * - 全件を 1 本の UPDATE … FROM jsonb_to_recordset で書く（件数でループしない＝Workers のサブリクエスト上限に当たらない）
 * - 応答の updated は RETURNING（書いた後の行の値）。呼び出し側は送った値と突き合わせて書き込みを確かめる
 * - 本文の形・検査は src/lib/whowatch/learned-points.ts。本文が空なら 0 件で 200（同期ルート共通テストの空 POST）
 * - drizzle/0023 未適用なら列が無いので 502（error は describeDbError の要約）
 */
export async function POST(request: Request) {
  const route = findSyncRoute(ROUTE_PATH);
  if (!route) return NextResponse.json({ error: `route not registered in SYNC_ROUTES: ${ROUTE_PATH}` }, { status: 500 });

  const auth = verifySyncKey(request.headers.get("x-sync-key"), process.env[route.envKey]);
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 });

  const text = await request.text().catch(() => "");
  let body: unknown = null;
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: "本文が JSON ではありません" }, { status: 400 });
    }
  }
  const parsed = parseLearnedBody(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  if (parsed.items.length === 0) {
    return NextResponse.json({ ok: true, requested: 0, updated: [], missing: [], at: new Date().toISOString() });
  }

  const db = createDbClient();
  try {
    const rows = await db.execute<UpdatedRow & Record<string, unknown>>(sql`
      UPDATE item_point_mapping AS m
         SET learned_point = v.point, learned_samples = v.samples, learned_at = now()
        FROM jsonb_to_recordset(${toRecordsetJson(parsed.items)}::jsonb) AS v(id text, num integer, point double precision, samples integer)
       WHERE m.platform = 'whowatch' AND (m.item_id = v.id OR (m.whowatch_id > 0 AND m.whowatch_id = v.num))
      RETURNING m.item_id, m.whowatch_id, m.learned_point, m.learned_samples`);
    const summary = summarizeUpdate(parsed.items, Array.from(rows));
    console.log(`[items/learned] ${summary.updated.length}/${parsed.items.length} 件を更新（行なし ${summary.missing.length} 件）`);
    return NextResponse.json({ ok: true, requested: parsed.items.length, ...summary, at: new Date().toISOString() });
  } catch (e) {
    const message = describeDbError(e);
    console.error("[items/learned] 失敗", message);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
