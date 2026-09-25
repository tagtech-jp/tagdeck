import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { streamerProfiles } from "@/lib/db/schema";
import { ensureUserRow } from "@/lib/db/ensure-user";
import { dbConstraintErrorResponse } from "@/lib/db/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";

const profileSchema = z.object({
  userId: z
    .string()
    .min(1, "ニコニコユーザー ID を入力してください")
    .max(20)
    .regex(/^\d+$/, "数字のみ使用可能です"),
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

  return NextResponse.json({
    niconicoUserId: profile?.niconicoUserId ?? null,
    niconicoProgramId: profile?.niconicoProgramId ?? null,
    niconicoIsLive: profile?.niconicoIsLive ?? false,
    niconicoTitle: profile?.niconicoTitle ?? null,
    niconicoViewerCount: profile?.niconicoViewerCount ?? 0,
    niconicoCommentCount: profile?.niconicoCommentCount ?? 0,
    niconicoPeakViewerCount: profile?.niconicoPeakViewerCount ?? 0,
    niconicoIsMonitoring: profile?.niconicoIsMonitoring ?? false,
    niconicoLastPolledAt: profile?.niconicoLastPolledAt?.toISOString() ?? null,
    niconicoLiveUrl: profile?.niconicoProgramId
      ? `https://live.nicovideo.jp/watch/${encodeURIComponent(profile.niconicoProgramId)}`
      : null,
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

  const db = createDbClient();

  try {
    await ensureUserRow(db, user);

    const [existing] = await db
      .select({ id: streamerProfiles.id })
      .from(streamerProfiles)
      .where(eq(streamerProfiles.userId, user.id))
      .limit(1);

    const updateData = {
      niconicoUserId: parsed.data.userId,
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

  return NextResponse.json({ success: true, niconicoUserId: parsed.data.userId });
}
