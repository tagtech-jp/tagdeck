import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { events, streamerProfiles } from "@/lib/db/schema";
import { summarizeStream, type StreamGiftRow } from "@/lib/live/stream-report";

/** 一覧に出す直近の配信数 */
const RECENT_STREAMS = 10;

/**
 * GET /api/live/report[?streamId=] → 自分の whowatch 配信の振り返りレポート（2026-10-06 社長指示）。
 * streams = 直近の配信（ギフトのある live_id）一覧、report = 指定（無ければ最新）の配信の集計。
 * 配信単位の記録テーブルは無いので、保存済みのギフト（events）を stream_id ごとに集計する。DB を読むだけ。
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createDbClient();
  const [profile] = await db.select({ id: streamerProfiles.id }).from(streamerProfiles).where(eq(streamerProfiles.userId, user.id)).limit(1);
  if (!profile) return NextResponse.json({ streams: [], report: null });

  const giftOf = and(eq(events.streamerId, profile.id), eq(events.platform, "whowatch"), eq(events.eventType, "gift"));
  const lastAt = sql<Date>`max(${events.occurredAt})`;
  const streams = await db
    .select({ streamId: events.streamId, firstAt: sql<Date>`min(${events.occurredAt})`, lastAt, gifts: sql<number>`count(*)::int` })
    .from(events)
    .where(and(giftOf, isNotNull(events.streamId)))
    .groupBy(events.streamId)
    .orderBy(desc(lastAt))
    .limit(RECENT_STREAMS);

  const wanted = new URL(request.url).searchParams.get("streamId");
  const streamId = wanted && streams.some((s) => s.streamId === wanted) ? wanted : (streams[0]?.streamId ?? null);
  let report = null;
  if (streamId) {
    const raw = await db
      .select({
        occurredAt: events.occurredAt,
        listenerId: events.listenerId,
        name: sql<string | null>`${events.payload}->'user'->>'name'`,
        itemName: sql<string | null>`${events.payload}->>'item_name'`,
        count: sql<string | null>`${events.payload}->>'count'`,
        totalYen: sql<string | null>`${events.payload}->>'total_yen'`,
      })
      .from(events)
      .where(and(giftOf, eq(events.streamId, streamId)));
    const rows: StreamGiftRow[] = raw.map((r) => ({
      occurredAt: new Date(r.occurredAt),
      listenerId: r.listenerId,
      name: r.name,
      itemName: r.itemName,
      count: Number(r.count) > 0 ? Number(r.count) : 1,
      totalYen: r.totalYen === null || r.totalYen === "" ? null : Number(r.totalYen),
    }));
    // この配信で投げた人の「初めて投げた時刻」（全配信を通して）。初めての人の判定に使う
    const ids = [...new Set(rows.map((r) => r.listenerId).filter((v): v is string => v !== null))];
    const firstGiftAt = new Map<string, Date>();
    if (ids.length > 0) {
      const firsts = await db
        .select({ listenerId: events.listenerId, firstAt: sql<Date>`min(${events.occurredAt})` })
        .from(events)
        .where(and(giftOf, inArray(events.listenerId, ids), gte(events.occurredAt, new Date(0))))
        .groupBy(events.listenerId);
      for (const f of firsts) if (f.listenerId) firstGiftAt.set(f.listenerId, new Date(f.firstAt));
    }
    report = summarizeStream(rows, firstGiftAt);
  }

  const res = NextResponse.json({
    streams: streams.map((s) => ({ streamId: s.streamId, firstAt: new Date(s.firstAt).toISOString(), lastAt: new Date(s.lastAt).toISOString(), gifts: Number(s.gifts) })),
    streamId,
    report,
  });
  res.headers.set("Cache-Control", "private, max-age=30");
  return res;
}
