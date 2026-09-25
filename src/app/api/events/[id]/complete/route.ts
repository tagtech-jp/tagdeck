import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators, eventHistory } from "@/lib/db/schema";
import { ensureUserRow } from "@/lib/db/ensure-user";
import { dbConstraintErrorResponse } from "@/lib/db/errors";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const completeBodySchema = z.object({
  finalScore: z.number().int().optional(),
  finalRank: z.number().int().optional(),
  achieved: z.boolean(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = completeBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { finalScore, finalRank, achieved } = parsed.data;

  // 重要: Drizzle は postgres ロール (BYPASSRLS) のため user_id 条件は必須
  const db = createDbClient();
  const [event] = await db
    .select()
    .from(eventSimulators)
    .where(and(eq(eventSimulators.id, id), eq(eventSimulators.userId, user.id)))
    .limit(1);

  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const finalRivals =
    (event.rivalsSnapshot?.rivals ?? []).map((r) => ({
      rank: r.rank,
      name: r.name,
      score: r.score,
    }));

  const now = new Date();

  try {
    // event_history.user_id の FK 先を保証（通常はイベント作成時点で存在する）
    await ensureUserRow(db, user);

    // トランザクション: event_history INSERT + event_simulators status UPDATE
    const [inserted] = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(eventHistory)
        .values({
          userId: user.id,
          eventId: event.id,
          name: event.name,
          platform: event.platform,
          eventType: event.eventType,
          startTime: event.startTime,
          endTime: now,
          finalScore: finalScore ?? null,
          finalRank: finalRank ?? null,
          targetScore: event.targetScore ?? null,
          targetRank: event.targetRank ?? null,
          achieved,
          fullPaceHistory: event.paceHistory as Array<{ timestamp: string; score: number }>,
          finalRivals,
        })
        .returning({ id: eventHistory.id });

      await tx
        .update(eventSimulators)
        .set({ status: "completed", updatedAt: now })
        .where(and(eq(eventSimulators.id, id), eq(eventSimulators.userId, user.id)));

      return rows;
    });

    return NextResponse.json({ success: true, eventHistoryId: inserted.id });
  } catch (err) {
    const res = dbConstraintErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
