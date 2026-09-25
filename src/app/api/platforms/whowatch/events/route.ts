import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { whowatchEvents } from "@/lib/db/schema";
import { and, inArray, notInArray, sql } from "drizzle-orm";
import {
  fetchWhowatchEventList,
  fetchWhowatchEvents,
  type WhowatchEventListItem,
} from "@/lib/platforms/whowatch/event-list";
import { resolveEventDisplayName } from "@/lib/platforms/whowatch/event-title";

/** 今回の event_lists 取得で pre/open ではなかった DB 行を closed に更新する（リコンサイル）。
 * オンデマンド同期(本 route)と日次 sync (sync_items_and_events.py) で同一ロジックを維持する。 */
async function reconcileClosedEvents(
  db: ReturnType<typeof createDbClient>,
  fetched: WhowatchEventListItem[]
): Promise<void> {
  const activeIds = fetched.filter((e) => e.status !== "closed").map((e) => e.id);
  const notClosedYet = inArray(whowatchEvents.status, ["pre", "open"]);
  await db
    .update(whowatchEvents)
    .set({ status: "closed" })
    .where(
      activeIds.length > 0
        ? and(notClosedYet, notInArray(whowatchEvents.id, activeIds))
        : notClosedYet
    );
}

// DB の open イベントがこの時間より古ければ event_lists を再取得（オンデマンド同期）
const STALE_MS = 6 * 60 * 60 * 1000; // 6 時間

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createDbClient();

  try {
    let rows = await db.select().from(whowatchEvents);

    // ── オンデマンド同期: DB が空 or 最新 last_synced_at が古ければ event_lists を再取得 ──
    const newestSync = rows.reduce(
      (m, r) => Math.max(m, r.lastSyncedAt?.getTime() ?? 0),
      0
    );
    const isStale = rows.length === 0 || Date.now() - newestSync > STALE_MS;

    if (isStale) {
      const deviceId = process.env.WHOWATCH_DEVICE_ID ?? "";
      const fetched = await fetchWhowatchEventList(deviceId);
      if (fetched.length > 0) {
        const now = new Date();
        // title_ja は set に含めず ON CONFLICT 時に既存値を保持
        await db
          .insert(whowatchEvents)
          .values(
            fetched.map((e) => ({
              id: e.id,
              eventKey: e.eventKey,
              bannerUrl: e.bannerUrl,
              status: e.status,
              badgeText: e.badgeText,
              badgeColor: e.badgeColor,
              badgeAnimation: e.badgeAnimation,
              startedAt: e.startedAt,
              endedAt: e.endedAt,
              participants: e.participants,
              lastSyncedAt: now,
            }))
          )
          .onConflictDoUpdate({
            target: whowatchEvents.id,
            set: {
              eventKey: sql`excluded.event_key`,
              bannerUrl: sql`excluded.banner_url`,
              status: sql`excluded.status`,
              badgeText: sql`excluded.badge_text`,
              badgeColor: sql`excluded.badge_color`,
              badgeAnimation: sql`excluded.badge_animation`,
              startedAt: sql`excluded.started_at`,
              endedAt: sql`excluded.ended_at`,
              participants: sql`excluded.participants`,
              lastSyncedAt: sql`excluded.last_synced_at`,
            },
          });

        // ── リコンサイル: 今回の pre/open に含まれない DB 行を closed に更新 ──
        await reconcileClosedEvents(db, fetched);

        rows = await db.select().from(whowatchEvents);
      }
    }

    // ── 開催中のみ: status=open かつ ended_at が未来（null は「終了時刻不明」として含める） ──
    const now = Date.now();
    const openRows = rows.filter(
      (r) => r.status === "open" && (r.endedAt == null || r.endedAt.getTime() > now)
    );

    // 表示名解決（手動辞書 → 整形 event_key）を付与
    // 表示名: 詳細同期で取れた正式名（/event_lists/{key} の name、例「オータムグッズ」）を最優先。無ければ従来の辞書→整形 event_key
    const open = openRows.map((r) => ({
      ...r,
      displayName: r.name?.trim() || r.titleJa?.trim() || resolveEventDisplayName(r.eventKey),
    }));

    const response = NextResponse.json({
      pre: [],
      open,
      closed: [],
      fetchedAt: new Date().toISOString(),
      source: "db",
    });
    response.headers.set("Cache-Control", "private, max-age=300");
    return response;
  } catch (dbErr) {
    console.error("[whowatch/events] DB error, falling back to scraper:", dbErr);
  }

  // ── フォールバック: スクレイパー（DB 接続不能時） ──
  try {
    const result = await fetchWhowatchEvents();
    const response = NextResponse.json({
      pre: [],
      open: result.events,
      closed: [],
      fetchedAt: new Date().toISOString(),
      source: result.source,
    });
    response.headers.set("Cache-Control", "private, max-age=300");
    return response;
  } catch (err) {
    console.error("[whowatch/events] fallback error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
