import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { eventSimulators } from "@/lib/db/schema";
import { ensureUserRow } from "@/lib/db/ensure-user";
import { dbConstraintErrorResponse } from "@/lib/db/errors";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const createSchema = z
  .object({
    name: z.string().min(1).max(100),
    platform: z.enum(["whowatch", "niconico", "manual"]).default("whowatch"),
    eventType: z.enum(["score", "ranking", "nice", "viewer"]).default("score"),
    targetScore: z.number().int().positive().optional(),
    targetRank: z.number().int().positive().optional(),
    startTime: z.string().datetime(),
    endTime: z.string().datetime(),
    eventRankingUrl: z.string().url().optional(),
    myEntryName: z.string().max(100).optional(),
    whowatchEventId: z.number().int().positive().nullable().optional(),
    // ランキング区分キー（例: autumncollection_1st_overall）。E1 で追加
    rankingType: z.string().min(1).max(200).regex(/^[a-z0-9_]+$/i).nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.eventType === "score") return data.targetScore !== undefined;
      if (data.eventType === "ranking" || data.eventType === "nice" || data.eventType === "viewer") {
        // R8: 目標順位/目標スコアのどちらかがあればよい（順位指定時はライバルスコア分布から逆算表示）
        return data.targetRank !== undefined || data.targetScore !== undefined;
      }
      return true;
    },
    { message: "イベントタイプに応じた必須項目が不足しています" }
  );

/** GET /api/events → アクティブなイベント一覧を返す */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createDbClient();
  const rows = await db
    .select()
    .from(eventSimulators)
    .where(and(eq(eventSimulators.userId, user.id), eq(eventSimulators.status, "active")))
    .orderBy(desc(eventSimulators.createdAt));

  return NextResponse.json({ events: rows });
}

/** POST /api/events → 新規イベント作成 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const d = parsed.data;
  const db = createDbClient();

  try {
    // プラットフォーム未連携ユーザーでも public.users 行を保証する（event_simulators.user_id の FK 先）
    await ensureUserRow(db, user);

    const [created] = await db
      .insert(eventSimulators)
      .values({
        userId: user.id,
        name: d.name,
        platform: d.platform,
        eventType: d.eventType,
        targetScore: d.targetScore ?? null,
        targetRank: d.targetRank ?? null,
        startTime: new Date(d.startTime),
        endTime: new Date(d.endTime),
        eventRankingUrl: d.eventRankingUrl ?? null,
        myEntryName: d.myEntryName ?? null,
        whowatchEventId: d.whowatchEventId ?? null,
        rankingType: d.rankingType ?? null,
      })
      .returning();

    return NextResponse.json({ event: created }, { status: 201 });
  } catch (err) {
    const res = dbConstraintErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
