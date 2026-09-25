import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeEventKind, endTimeFromEndedAt, getEventLists, WhowatchEventApiError } from "@/lib/whowatch/events";

/**
 * GET /api/platforms/whowatch/events/list → open / pre のイベント一覧（E1）
 * /event_lists を 10 分キャッシュで読む。認証必須。DB は触らない（詳細は /events/{event_key} が保存する）。
 * 既存の GET /api/platforms/whowatch/events（DB 優先・open のみ・displayName 付き）は変更しない。
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const lists = await getEventLists();
    const shape = (items: typeof lists.open) =>
      items.map((e) => ({
        id: e.id,
        eventKey: e.eventKey,
        bannerUrl: e.bannerUrl,
        status: e.status,
        badgeText: e.badgeText,
        canEntry: e.canEntry,
        participants: e.participants,
        startedAt: e.startedAt ? new Date(e.startedAt).toISOString() : null,
        endedAt: e.endedAt ? new Date(e.endedAt).toISOString() : null,
        // イベント終了 = ended_at + 1 秒（翌日 00:00:00 JST）
        endTime: e.endedAt ? endTimeFromEndedAt(e.endedAt).toISOString() : null,
        kind: computeEventKind(e.startedAt, e.endedAt),
      }));
    const res = NextResponse.json({ open: shape(lists.open), pre: shape(lists.pre), fetchedAt: new Date().toISOString() });
    res.headers.set("Cache-Control", "private, max-age=60");
    return res;
  } catch (err) {
    const status = err instanceof WhowatchEventApiError ? 502 : 500;
    console.error("[whowatch/events/list]", err);
    return NextResponse.json({ error: "イベント一覧を取得できませんでした" }, { status });
  }
}
