import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { streamerProfiles } from "@/lib/db/schema";
import { fetchNicoLive, NiconicoApiException } from "@/lib/platforms/niconico";
import { eq } from "drizzle-orm";

const POLL_INTERVAL_MS = 4500;

export async function POST() {
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

  if (!profile?.niconicoIsMonitoring || !profile.niconicoUserId) {
    return NextResponse.json({ status: "not_monitoring" });
  }

  // Rate limit: skip if polled too recently
  if (profile.niconicoLastPolledAt) {
    const elapsed = Date.now() - profile.niconicoLastPolledAt.getTime();
    if (elapsed < POLL_INTERVAL_MS) {
      return NextResponse.json({
        status: "rate_limited",
        retryAfter: POLL_INTERVAL_MS - elapsed,
      });
    }
  }

  let program;
  try {
    program = await fetchNicoLive(profile.niconicoUserId);
  } catch (err) {
    const now = new Date();
    if (err instanceof NiconicoApiException && err.status === 404) {
      await db
        .update(streamerProfiles)
        .set({ niconicoIsLive: false, niconicoLastPolledAt: now, updatedAt: now })
        .where(eq(streamerProfiles.userId, user.id));
      return NextResponse.json({ status: "not_found" });
    }
    return NextResponse.json({ error: "ニコ生取得エラー" }, { status: 502 });
  }

  const now = new Date();

  if (!program) {
    await db
      .update(streamerProfiles)
      .set({ niconicoIsLive: false, niconicoLastPolledAt: now, updatedAt: now })
      .where(eq(streamerProfiles.userId, user.id));
    return NextResponse.json({ status: "offline" });
  }

  const peakViewerCount = Math.max(
    profile.niconicoPeakViewerCount ?? 0,
    program.viewerCount,
  );

  await db
    .update(streamerProfiles)
    .set({
      niconicoProgramId: program.programId,
      niconicoCommunityId: program.communityId,
      niconicoIsLive: program.isLive,
      niconicoTitle: program.title,
      niconicoViewerCount: program.viewerCount,
      niconicoCommentCount: program.commentCount,
      niconicoPeakViewerCount: peakViewerCount,
      niconicoStartedAt: program.startedAt,
      niconicoLastPolledAt: now,
      updatedAt: now,
    })
    .where(eq(streamerProfiles.userId, user.id));

  return NextResponse.json({
    status: program.isLive ? "live" : "scheduled",
    programId: program.programId,
    title: program.title,
    viewerCount: program.viewerCount,
    commentCount: program.commentCount,
    isLive: program.isLive,
  });
}
