import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { streamerProfiles, listeners, events } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

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

  if (type === "chat_message") {
    const sender = payload.sender as Record<string, unknown> | undefined;
    if (sender?.username) {
      const platformUserId = String(sender.id);

      const [existing] = await db
        .select()
        .from(listeners)
        .where(
          and(
            eq(listeners.streamerId, profile.id),
            eq(listeners.platform, "kick"),
            eq(listeners.platformUserId, platformUserId),
          ),
        )
        .limit(1);

      let listenerId: string;
      if (!existing) {
        const [newListener] = await db
          .insert(listeners)
          .values({
            streamerId: profile.id,
            platform: "kick",
            platformUserId,
            displayName: String(sender.username),
            lastSeenAt: new Date(),
            totalCommentCount: 1,
          })
          .returning({ id: listeners.id });
        listenerId = newListener.id;
      } else {
        listenerId = existing.id;
        await db
          .update(listeners)
          .set({
            lastSeenAt: new Date(),
            totalCommentCount: (existing.totalCommentCount ?? 0) + 1,
          })
          .where(eq(listeners.id, listenerId));
      }

      await db.insert(events).values({
        streamerId: profile.id,
        listenerId,
        platform: "kick",
        eventType: "comment",
        payload: payload as Record<string, unknown>,
      });
    }
  } else if (type === "gift_subscription" || type === "subscription") {
    const sender =
      (payload.gifter as Record<string, unknown> | undefined) ??
      (payload.user as Record<string, unknown> | undefined);

    await db.insert(events).values({
      streamerId: profile.id,
      platform: "kick",
      eventType: "gift",
      payload: payload as Record<string, unknown>,
      listenerId: null,
    });

    if (sender?.username) {
      const platformUserId = String(sender.id ?? sender.username);
      const [existing] = await db
        .select()
        .from(listeners)
        .where(
          and(
            eq(listeners.streamerId, profile.id),
            eq(listeners.platform, "kick"),
            eq(listeners.platformUserId, platformUserId),
          ),
        )
        .limit(1);

      if (!existing) {
        await db.insert(listeners).values({
          streamerId: profile.id,
          platform: "kick",
          platformUserId,
          displayName: String(sender.username),
          lastSeenAt: new Date(),
          totalGiftAmount: 1,
        });
      } else {
        await db
          .update(listeners)
          .set({
            lastSeenAt: new Date(),
            totalGiftAmount: (existing.totalGiftAmount ?? 0) + 1,
          })
          .where(eq(listeners.id, existing.id));
      }
    }
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
