import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { streamerProfiles } from "@/lib/db/schema";
import { ensureUserRow } from "@/lib/db/ensure-user";
import { dbConstraintErrorResponse } from "@/lib/db/errors";
import { buildKickLiveUrl, fetchKickChannel, KickApiException } from "@/lib/platforms/kick";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

const profileSchema = z.object({
  username: z
    .string()
    .min(1, "Kick username を入力してください")
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, "英数字とアンダースコアのみ使用可能です"),
});

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createDbClient();
  const [profile] = await db
    .select()
    .from(streamerProfiles)
    .where(eq(streamerProfiles.userId, user.id))
    .limit(1);

  if (profile?.kickUsername) {
    try {
      const channelInfo = await fetchKickChannel(profile.kickUsername);
      if (channelInfo) {
        const [updated] = await db
          .update(streamerProfiles)
          .set({
            kickUsername: channelInfo.username,
            kickChannelId: channelInfo.channelId,
            kickChatroomId: channelInfo.chatroomId,
            kickIsLive: channelInfo.isLive,
            kickViewerCount: channelInfo.viewerCount,
            kickPeakViewerCount: sql`GREATEST(${streamerProfiles.kickPeakViewerCount}, ${channelInfo.viewerCount})`,
            kickFollowerCount: channelInfo.followerCount,
            updatedAt: new Date(),
          })
          .where(eq(streamerProfiles.userId, user.id))
          .returning();

        return NextResponse.json({
          kickUsername: updated.kickUsername,
          kickChannelId: updated.kickChannelId,
          kickChatroomId: updated.kickChatroomId,
          kickIsLive: updated.kickIsLive,
          kickViewerCount: updated.kickViewerCount,
          kickPeakViewerCount: updated.kickPeakViewerCount,
          kickFollowerCount: updated.kickFollowerCount,
          kickIsMonitoring: updated.kickIsMonitoring,
          kickLiveUrl: buildKickLiveUrl(updated.kickUsername),
        });
      }
    } catch {
      // Pusher の保存済み状態は返し、REST の一時失敗でダッシュボードを壊さない
    }
  }

  const fallbackIsLive = Boolean(
    profile?.kickIsLive ||
      ((profile?.kickIsMonitoring ?? false) && (profile?.kickViewerCount ?? 0) > 0),
  );

  return NextResponse.json({
    kickUsername: profile?.kickUsername ?? null,
    kickChannelId: profile?.kickChannelId ?? null,
    kickChatroomId: profile?.kickChatroomId ?? null,
    kickIsLive: fallbackIsLive,
    kickViewerCount: profile?.kickViewerCount ?? 0,
    kickPeakViewerCount: profile?.kickPeakViewerCount ?? 0,
    kickFollowerCount: profile?.kickFollowerCount ?? 0,
    kickIsMonitoring: profile?.kickIsMonitoring ?? false,
    kickLiveUrl: buildKickLiveUrl(profile?.kickUsername),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  let channelInfo;
  try {
    channelInfo = await fetchKickChannel(parsed.data.username);
  } catch (err) {
    if (err instanceof KickApiException) {
      return NextResponse.json({ error: `Kick API エラー: ${err.code}` }, { status: 502 });
    }
    return NextResponse.json({ error: "通信エラーが発生しました" }, { status: 502 });
  }

  if (!channelInfo) {
    return NextResponse.json(
      { error: "Kick ユーザーが見つかりません" },
      { status: 404 },
    );
  }

  const db = createDbClient();

  try {
    await ensureUserRow(db, user);

    const [existing] = await db
      .select({ id: streamerProfiles.id })
      .from(streamerProfiles)
      .where(eq(streamerProfiles.userId, user.id))
      .limit(1);

    const updateData = {
      kickUsername: channelInfo.username,
      kickChannelId: channelInfo.channelId,
      kickChatroomId: channelInfo.chatroomId,
      kickIsLive: channelInfo.isLive,
      kickViewerCount: channelInfo.viewerCount,
      kickFollowerCount: channelInfo.followerCount,
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(streamerProfiles)
        .set(updateData)
        .where(eq(streamerProfiles.userId, user.id));
    } else {
      await db.insert(streamerProfiles).values({ userId: user.id, ...updateData });
    }
  } catch (err) {
    const res = dbConstraintErrorResponse(err);
    if (res) return res;
    throw err;
  }

  return NextResponse.json({
    success: true,
    channelInfo: {
      username: channelInfo.username,
      followerCount: channelInfo.followerCount,
      isLive: channelInfo.isLive,
    },
  });
}
