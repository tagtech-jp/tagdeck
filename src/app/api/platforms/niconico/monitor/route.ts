import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { streamerProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const monitorSchema = z.object({
  action: z.enum(["start", "stop"]),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = monitorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const db = createDbClient();
  const [profile] = await db
    .select()
    .from(streamerProfiles)
    .where(eq(streamerProfiles.userId, user.id))
    .limit(1);

  if (!profile?.niconicoUserId) {
    return NextResponse.json(
      { error: "ニコニコユーザー ID が設定されていません" },
      { status: 400 },
    );
  }

  const isMonitoring = parsed.data.action === "start";
  await db
    .update(streamerProfiles)
    .set({
      niconicoIsMonitoring: isMonitoring,
      niconicoMonitoringStartedAt: isMonitoring ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(streamerProfiles.userId, user.id));

  return NextResponse.json({ success: true, isMonitoring });
}
