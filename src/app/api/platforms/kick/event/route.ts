import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { streamerProfiles, listeners, events } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * リスナーを探す／無ければ作る（累計 0 で作る）。累計はここでは足さない（2026-10-02・whowatch/live/poll と同じ方針）。
 * 足すのは events への保存と同じトランザクションの中で、SQL の中で行う（読んでから足すと、同時に来た分が消える）
 */
async function findOrCreateListener(db: ReturnType<typeof createDbClient>, streamerId: string, platformUserId: string, displayName: string): Promise<string | null> {
  const [existing] = await db
    .select({ id: listeners.id })
    .from(listeners)
    .where(and(eq(listeners.streamerId, streamerId), eq(listeners.platform, "kick"), eq(listeners.platformUserId, platformUserId)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(listeners)
    .values({ streamerId, platform: "kick", platformUserId, displayName, lastSeenAt: new Date(), totalCommentCount: 0, totalGiftAmount: 0 })
    .returning({ id: listeners.id });
  return created?.id ?? null;
}

const eventSchema = z.object({
  type: z.enum([
    "chat_message",
    "gift_subscription",
    "subscription",
    "streamer_live",
    "stop_stream",
  ]),
  payload: z.record(z.string(), z.unknown()),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }

  const db = createDbClient();
  const [profile] = await db
    .select()
    .from(streamerProfiles)
    .where(eq(streamerProfiles.userId, user.id))
    .limit(1);

  if (!profile?.kickIsMonitoring) {
    return NextResponse.json({ status: "not_monitoring" });
  }

  const { type, payload } = parsed.data;

  // Kick は events に重複判定のキー（platform_comment_id）を入れていないので、同じイベントを 2 台のブラウザが
  // 送ると events も累計も二重になる（両者は一致したまま）。キーを入れるときは whowatch/live/poll と同じく
  // onConflictDoNothing().returning() で 0 行なら足さない形にする。保存と加算は同じトランザクションなので、
  // 保存が失敗すれば加算も巻き戻る
  if (type === "chat_message") {
    const sender = payload.sender as Record<string, unknown> | undefined;
    if (sender?.username) {
      const listenerId = await findOrCreateListener(db, profile.id, String(sender.id), String(sender.username));
      await db.transaction(async (tx) => {
        await tx.insert(events).values({
          streamerId: profile.id,
          listenerId,
          platform: "kick",
          eventType: "comment",
          payload: payload as Record<string, unknown>,
        });
        if (!listenerId) return;
        await tx
          .update(listeners)
          .set({ lastSeenAt: new Date(), totalCommentCount: sql`coalesce(${listeners.totalCommentCount}, 0) + 1` })
          .where(eq(listeners.id, listenerId));
      });
    }
  } else if (type === "gift_subscription" || type === "subscription") {
    const sender =
      (payload.gifter as Record<string, unknown> | undefined) ??
      (payload.user as Record<string, unknown> | undefined);
    const listenerId = sender?.username
      ? await findOrCreateListener(db, profile.id, String(sender.id ?? sender.username), String(sender.username))
      : null;

    await db.transaction(async (tx) => {
      // ギフトの行は従来どおり listener_id を持たせない（表示は payload の gifter 名で行っている）
      await tx.insert(events).values({
        streamerId: profile.id,
        platform: "kick",
        eventType: "gift",
        payload: payload as Record<string, unknown>,
        listenerId: null,
      });
      if (!listenerId) return;
      await tx
        .update(listeners)
        .set({ lastSeenAt: new Date(), totalGiftAmount: sql`coalesce(${listeners.totalGiftAmount}, 0) + 1` })
        .where(eq(listeners.id, listenerId));
    });
  } else if (type === "streamer_live") {
    await db
      .update(streamerProfiles)
      .set({ kickIsLive: true, kickLastEventAt: new Date(), updatedAt: new Date() })
      .where(eq(streamerProfiles.userId, user.id));
    return NextResponse.json({ success: true });
  } else if (type === "stop_stream") {
    await db
      .update(streamerProfiles)
      .set({ kickIsLive: false, kickLastEventAt: new Date(), updatedAt: new Date() })
      .where(eq(streamerProfiles.userId, user.id));
    return NextResponse.json({ success: true });
  }

  await db
    .update(streamerProfiles)
    .set({ kickIsLive: true, kickLastEventAt: new Date(), updatedAt: new Date() })
    .where(eq(streamerProfiles.userId, user.id));

  return NextResponse.json({ success: true });
}
