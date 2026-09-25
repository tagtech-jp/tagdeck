import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { events, listeners, streamerProfiles } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

// Kick の chat_message / gift_subscription はそのまま生 Pusher ペイロードを payload に保存している
// （src/app/api/platforms/kick/event/route.ts 参照）ため、表示に使うフィールド名は
// Kick 公式 Pusher プロトコルの一般的な形（content / gifter.username / gifted_usernames）を
// 前提に抽出する。(要確認) 実配信での実ペイロードによる検証は未実施。
type KickCommentPayload = { sender?: { username?: string }; content?: string };
type KickGiftPayload = {
  gifter?: { username?: string };
  user?: { username?: string };
  gifted_usernames?: unknown;
};

export type StreamActivityItem = {
  id: string;
  type: "comment" | "gift";
  listenerName: string;
  message?: string;
  amount?: number;
  occurredAt: string;
};

/** 配信中の実イベント（コメント/ギフト）フィード。現状 Kick のみ本文取得経路あり（whowatch/ニコ生は取得不可）。 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createDbClient();
  const [profile] = await db
    .select()
    .from(streamerProfiles)
    .where(eq(streamerProfiles.userId, user.id))
    .limit(1);

  if (!profile) {
    return NextResponse.json({ streamerProfileId: null, items: [] });
  }

  const rows = await db
    .select({
      id: events.id,
      eventType: events.eventType,
      payload: events.payload,
      occurredAt: events.occurredAt,
      listenerDisplayName: listeners.displayName,
    })
    .from(events)
    .leftJoin(listeners, eq(events.listenerId, listeners.id))
    .where(and(eq(events.streamerId, profile.id), eq(events.platform, "kick")))
    .orderBy(desc(events.occurredAt))
    .limit(20);

  const items: StreamActivityItem[] = rows
    .filter((r) => r.eventType === "comment" || r.eventType === "gift")
    .map((r) => {
      const occurredAt = r.occurredAt.toISOString();

      if (r.eventType === "comment") {
        const payload = (r.payload ?? {}) as KickCommentPayload;
        return {
          id: r.id,
          type: "comment" as const,
          listenerName: r.listenerDisplayName ?? payload.sender?.username ?? "リスナー",
          message: typeof payload.content === "string" ? payload.content : undefined,
          occurredAt,
        };
      }

      const payload = (r.payload ?? {}) as KickGiftPayload;
      const gifterName = payload.gifter?.username ?? payload.user?.username;
      const amount = Array.isArray(payload.gifted_usernames)
        ? payload.gifted_usernames.length
        : undefined;
      return {
        id: r.id,
        type: "gift" as const,
        listenerName: r.listenerDisplayName ?? gifterName ?? "リスナー",
        amount,
        occurredAt,
      };
    });

  const response = NextResponse.json({ streamerProfileId: profile.id, items });
  response.headers.set("Cache-Control", "private, max-age=5");
  return response;
}
