import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { streamerProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json() as { action?: "start" | "stop" };
  if (body.action !== "start" && body.action !== "stop") {
    return NextResponse.json({ error: "action must be start or stop" }, { status: 400 });
  }

  const db = createDbClient();
  const [existing] = await db
    .select()
    .from(streamerProfiles)
    .where(eq(streamerProfiles.userId, user.id))
    .limit(1);

  if (!existing?.whowatchUserId) {
    return NextResponse.json({ error: "ふわっちユーザーIDが未設定です" }, { status: 400 });
  }

  const isMonitoring = body.action === "start";
  const [updated] = await db
    .update(streamerProfiles)
    .set({
      whowatchIsMonitoring: isMonitoring,
      whowatchMonitoringStartedAt: isMonitoring ? new Date() : null,
      ...(body.action === "stop" && {
        whowatchLiveId: null,
        whowatchViewerCount: 0,
        whowatchCurrentPoints: 0,
        whowatchPeakViewerCount: 0,
      }),
    })
    .where(eq(streamerProfiles.userId, user.id))
    .returning();

  return NextResponse.json({ isMonitoring: updated!.whowatchIsMonitoring });
}
