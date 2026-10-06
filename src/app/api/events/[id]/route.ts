import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators } from "@/lib/db/schema";
import { ownedSimulator, SIMULATOR_DELETED_STATUS } from "@/lib/events/simulator-scope";

const patchScoreSchema = z.object({
  score: z.number().int().min(0),
});

// E1b: イベント設定の編集（区分変更 → ranking_type と期間を更新）
const patchSettingsSchema = z
  .object({
    // 2026-10-07: 期間限定アイテム型（limited-item-2026_10_gold_digger_1-2）はハイフンを含む。null で「自動判定に戻す」
    rankingType: z.string().min(1).max(200).regex(/^[a-z0-9_-]+$/i).nullable().optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    name: z.string().min(1).max(100).optional(),
    // E3/E4: 目標順位（1〜5）
    targetRank: z.number().int().min(1).max(5).optional(),
  })
  .refine((d) => d.rankingType !== undefined || d.startTime !== undefined || d.endTime !== undefined || d.name !== undefined || d.targetRank !== undefined, {
    message: "更新項目がありません",
  });

/** PATCH /api/events/[id] → score型イベント等の現在スコアを手動入力する。
 * ranking型はpoll/refresh-rankingが自動同期するため通常不要だが、名前不一致時の補正等にも使える。
 * スコア変化時のみpaceHistoryへ追加（poll/route.tsのランキング同期ループと同一ロジック）。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);

  // ── E1b: 設定編集（score を含まないリクエスト）──
  if (body && typeof body === "object" && !("score" in (body as Record<string, unknown>))) {
    const ps = patchSettingsSchema.safeParse(body);
    if (!ps.success) {
      return NextResponse.json({ error: "rankingType / startTime / endTime / name のいずれかを正しく指定してください" }, { status: 400 });
    }
    const d = ps.data;
    if (d.startTime && d.endTime && new Date(d.endTime).getTime() <= new Date(d.startTime).getTime()) {
      return NextResponse.json({ error: "終了日時は開始日時より後にしてください" }, { status: 400 });
    }
    const dbs = createDbClient();
    const [updatedSettings] = await dbs
      .update(eventSimulators)
      .set({
        ...(d.rankingType !== undefined ? { rankingType: d.rankingType } : {}),
        ...(d.startTime !== undefined ? { startTime: new Date(d.startTime) } : {}),
        ...(d.endTime !== undefined ? { endTime: new Date(d.endTime) } : {}),
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.targetRank !== undefined ? { targetRank: d.targetRank } : {}),
        updatedAt: new Date(),
      })
      .where(ownedSimulator(id, user.id))
      .returning();
    if (!updatedSettings) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ event: updatedSettings });
  }

  const parsed = patchScoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "score は0以上の整数で入力してください" }, { status: 400 });
  }
  const { score } = parsed.data;

  const db = createDbClient();
  const [event] = await db
    .select()
    .from(eventSimulators)
    .where(ownedSimulator(id, user.id))
    .limit(1);

  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const existingPaceHistory = (event.paceHistory ?? []) as Array<{
    timestamp: string;
    score: number;
  }>;
  const lastPace = existingPaceHistory.at(-1);
  const ts = new Date();
  const shouldAppendPace = existingPaceHistory.length === 0 || score !== lastPace?.score;

  const [updated] = await db
    .update(eventSimulators)
    .set({
      manualScore: score,
      currentScore: score,
      paceHistory: shouldAppendPace
        ? [...existingPaceHistory.slice(-499), { timestamp: ts.toISOString(), score }]
        : existingPaceHistory,
      updatedAt: ts,
    })
    .where(ownedSimulator(id, user.id))
    .returning();

  return NextResponse.json({ event: updated });
}

/** DELETE /api/events/[id] → 自分のイベントを削除する（論理削除: status を "deleted" にする）。
 * 行は消さない。ranking_snapshots は event_simulators.id を外部キー（ON DELETE CASCADE・drizzle/0011）で参照しており、
 * 行を消すとランキング履歴が一緒に消えるため（2026-09-30 に、削除済みの秋コレのシミュレーターの履歴が 0 件になっているのを確認）。
 * 削除済みは一覧・Cron・poll（status = "active" で絞る）と、id 指定の API（ownedSimulator で絞る）から外れる。
 * event_history.event_id は event_simulators.id への実FK制約を持たない（削除後も履歴保持する設計）。 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 重要: Drizzle は postgres ロール (BYPASSRLS) のため user_id 条件は必須（自分のイベントのみ削除可）
  const db = createDbClient();
  const [deleted] = await db
    .update(eventSimulators)
    .set({ status: SIMULATOR_DELETED_STATUS, updatedAt: new Date() })
    .where(ownedSimulator(id, user.id))
    .returning({ id: eventSimulators.id });

  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ success: true });
}
