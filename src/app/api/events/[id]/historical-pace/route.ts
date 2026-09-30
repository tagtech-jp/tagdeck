import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventHistory, eventSimulators } from "@/lib/db/schema";
import { ownedSimulator } from "@/lib/events/simulator-scope";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const querySchema = z.object({
  eventType: z.enum(["score", "ranking", "nice", "viewer"]),
});

type PaceEntry = { timestamp: string; score: number };

function computeEventPaceMean(paceHistory: PaceEntry[]): number | null {
  if (!Array.isArray(paceHistory) || paceHistory.length < 2) return null;
  const paces: number[] = [];
  for (let i = 1; i < paceHistory.length; i++) {
    const dt =
      new Date(paceHistory[i].timestamp).getTime() -
      new Date(paceHistory[i - 1].timestamp).getTime();
    const ds = paceHistory[i].score - paceHistory[i - 1].score;
    if (dt > 0 && ds >= 0) paces.push((ds / dt) * 3_600_000);
  }
  if (paces.length === 0) return null;
  return paces.reduce((a, b) => a + b, 0) / paces.length;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ eventType: searchParams.get("eventType") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid eventType" }, { status: 400 });
  }
  const { eventType } = parsed.data;

  // 重要: Drizzle は postgres ロール (BYPASSRLS) のため user_id 条件は必須
  const db = createDbClient();

  // 集計は event_history（user_id × eventType）だけで行うが、他の [id] ルートと揃えて
  // 本人の・削除済みでないシミュレーターでなければ見つからない扱い（404）にする
  const [ev] = await db
    .select({ id: eventSimulators.id })
    .from(eventSimulators)
    .where(ownedSimulator(id, user.id))
    .limit(1);
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const records = await db
    .select({
      fullPaceHistory: eventHistory.fullPaceHistory,
    })
    .from(eventHistory)
    .where(
      and(
        eq(eventHistory.userId, user.id),
        eq(eventHistory.eventType, eventType)
      )
    )
    .limit(50);

  const means: number[] = [];
  for (const record of records) {
    const ph = record.fullPaceHistory as PaceEntry[] | null;
    const m = computeEventPaceMean(ph ?? []);
    if (m !== null) means.push(m);
  }

  const sampleCount = means.length;
  let historicalMean = 0;
  let historicalStd = 0;

  if (sampleCount >= 1) {
    historicalMean = means.reduce((a, b) => a + b, 0) / sampleCount;
    const variance =
      means.reduce((acc, m) => acc + (m - historicalMean) ** 2, 0) / sampleCount;
    historicalStd = Math.sqrt(variance);
  }

  const response = NextResponse.json({
    historicalMean,
    historicalStd,
    sampleCount,
    hasSufficientData: sampleCount >= 1,
  });
  response.headers.set("Cache-Control", "private, max-age=300");
  return response;
}
