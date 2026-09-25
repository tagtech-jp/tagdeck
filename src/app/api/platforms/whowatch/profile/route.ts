import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { streamerProfiles } from "@/lib/db/schema";
import { ensureUserRow } from "@/lib/db/ensure-user";
import { dbConstraintErrorResponse } from "@/lib/db/errors";
import { buildWhowatchLiveUrl } from "@/lib/platforms/whowatch";
import { eq } from "drizzle-orm";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = createDbClient();
  const [profile] = await db
    .select()
    .from(streamerProfiles)
    .where(eq(streamerProfiles.userId, user.id))
    .limit(1);

  if (!profile) {
    return NextResponse.json({
      whowatchUserId: null,
      whowatchIsMonitoring: false,
      whowatchViewerCount: 0,
      whowatchCurrentPoints: 0,
      whowatchPeakViewerCount: 0,
      whowatchLiveId: null,
      whowatchLiveUrl: null,
      whowatchLastPolledAt: null,
    });
  }

  return NextResponse.json({
    whowatchUserId: profile.whowatchUserId,
    whowatchIsMonitoring: profile.whowatchIsMonitoring,
    whowatchViewerCount: profile.whowatchViewerCount,
    whowatchCurrentPoints: profile.whowatchCurrentPoints,
    whowatchPeakViewerCount: profile.whowatchPeakViewerCount,
    whowatchLiveId: profile.whowatchLiveId,
    whowatchLiveUrl: buildWhowatchLiveUrl(profile.whowatchLiveId),
    whowatchLastPolledAt: profile.whowatchLastPolledAt?.toISOString() ?? null,
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json() as { whowatchUserId?: string };
  const whowatchUserId = body.whowatchUserId?.trim() || null;

  // w: = ふわっちID / t: = 連携XのID。prefix なしは live 取得時に両方試して解決する
  if (whowatchUserId && !/^(?:(?:w|t|ふ):)?@?[A-Za-z0-9_]+$/i.test(whowatchUserId)) {
    return NextResponse.json(
      { error: "ふわっち配信IDは英数字（@ や w: / t: 付きも可）、または数値IDで入力してください" },
      { status: 400 }
    );
  }

  const db = createDbClient();

  let profile;
  try {
    // public.users に行がなければ作成（auth.users との同期）
    await ensureUserRow(db, user);

    const [existing] = await db
      .select({ id: streamerProfiles.id })
      .from(streamerProfiles)
      .where(eq(streamerProfiles.userId, user.id))
      .limit(1);

    if (existing) {
      [profile] = await db
        .update(streamerProfiles)
        .set({ whowatchUserId })
        .where(eq(streamerProfiles.userId, user.id))
        .returning();
    } else {
      [profile] = await db
        .insert(streamerProfiles)
        .values({ userId: user.id, whowatchUserId })
        .returning();
    }
  } catch (err) {
    const res = dbConstraintErrorResponse(err);
    if (res) return res;
    throw err;
  }

  return NextResponse.json({
    whowatchUserId: profile!.whowatchUserId,
    whowatchIsMonitoring: profile!.whowatchIsMonitoring,
    whowatchViewerCount: profile!.whowatchViewerCount,
    whowatchCurrentPoints: profile!.whowatchCurrentPoints,
    whowatchPeakViewerCount: profile!.whowatchPeakViewerCount,
    whowatchLiveId: profile!.whowatchLiveId,
    whowatchLiveUrl: buildWhowatchLiveUrl(profile!.whowatchLiveId),
    whowatchLastPolledAt: profile!.whowatchLastPolledAt?.toISOString() ?? null,
  });
}
