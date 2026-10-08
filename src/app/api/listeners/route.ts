import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { createDbClient } from "@/lib/db/client";
import { listeners, streamerProfiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import type { Listener, ListenerRank } from "@/types/listener";
import type { Platform } from "@/types/platform";

type SerializedListener = Omit<Listener, "lastSeenAt" | "firstSeenAt"> & {
  lastSeenAt: string;
  firstSeenAt: string;
};

const platforms = new Set<Platform>(["whowatch", "kick", "niconico"]);

function toPlatform(value: string): Platform | null {
  return platforms.has(value as Platform) ? (value as Platform) : null;
}

/**
 * CRM のランク。totalGiftAmount は「ギフトの定価の合計（円）」（listeners.total_gift_amount・2026-10-08 に単位を円へ統一・監査 §3-6）。
 * whowatch は 1 回のギフトの total_yen（price_yen × count）の累計で、1pt = ¥1 の定価。Kick はサブスクギフトの金額が取れないので常に 0
 * （rank はコメント数だけで決まる）。しきい値 top ≥ ¥50,000 / vip ≥ ¥10,000 は 2026-10-08 社長確認で据え置き。
 * newcomer はギフト ¥0 かつコメント 3 件以下
 */
function toRank(totalGiftAmount: number, totalCommentCount: number): ListenerRank {
  if (totalGiftAmount >= 50000) return "top"; // 累計 ¥50,000 以上
  if (totalGiftAmount >= 10000) return "vip"; // 累計 ¥10,000 以上
  if (totalGiftAmount === 0 && totalCommentCount <= 3) return "newcomer";
  return "regular";
}

function serializeDate(value: Date | null, fallback: Date): string {
  return (value ?? fallback).toISOString();
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createDbClient();
  const [profile] = await db
    .select()
    .from(streamerProfiles)
    .where(eq(streamerProfiles.userId, user.id))
    .limit(1);

  if (!profile) {
    return NextResponse.json({
      streamerProfileId: null,
      streamerUserIds: {
        whowatch: null,
        kick: null,
        niconico: null,
      },
      listeners: [],
    });
  }

  const rows = await db
    .select()
    .from(listeners)
    .where(eq(listeners.streamerId, profile.id))
    .orderBy(desc(listeners.lastSeenAt), desc(listeners.createdAt))
    .limit(100);

  const serialized = rows.reduce<SerializedListener[]>((acc, row) => {
    const platform = toPlatform(row.platform);
    if (!platform) return acc;

    const totalGiftAmount = row.totalGiftAmount ?? 0;
    const totalCommentCount = row.totalCommentCount ?? 0;
    const firstSeenAt = row.createdAt;
    const lastSeenAt = row.lastSeenAt ?? firstSeenAt;

    acc.push({
      id: row.id,
      platform,
      platformUserId: row.platformUserId,
      displayName: row.displayName ?? row.platformUserId,
      nickname: row.nickname ?? undefined,
      rank: toRank(totalGiftAmount, totalCommentCount),
      totalGiftAmount,
      totalCommentCount,
      lastSeenAt: serializeDate(lastSeenAt, firstSeenAt),
      firstSeenAt: serializeDate(firstSeenAt, lastSeenAt),
      isOnline: Date.now() - lastSeenAt.getTime() < 5 * 60 * 1000,
      notes: row.notes ?? undefined,
      tags: [],
    });

    return acc;
  }, []);

  return NextResponse.json({
    streamerProfileId: profile.id,
    streamerUserIds: {
      whowatch: profile.whowatchUserId,
      kick: profile.kickUsername,
      niconico: profile.niconicoUserId,
    },
    listeners: serialized,
  });
}
