import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { WhowatchEventApiError } from "@/lib/whowatch/events";
import { syncEventDetail, shapeEventDetail } from "@/lib/whowatch/event-detail-sync";

const EVENT_KEY_RE = /^[a-z0-9_\-]{1,100}$/i;

/**
 * GET /api/platforms/whowatch/events/{event_key} → 詳細 + ランキング構造 + ルール本文 + 区分期間（E1/E1b）
 * オンデマンド: detail_fetched_at が NULL または 24 時間以上前なら、その場で API から取得して whowatch_events に保存する。
 * ?refresh=1 で強制再取得。本体は src/lib/whowatch/event-detail-sync.ts（日次同期・手動同期と共通）。
 */
export async function GET(request: Request, { params }: { params: Promise<{ event_key: string }> }) {
  const { event_key: eventKey } = await params;
  if (!EVENT_KEY_RE.test(eventKey)) return NextResponse.json({ error: "invalid event_key" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const force = new URL(request.url).searchParams.get("refresh") === "1";
  const db = createDbClient();
  try {
    const view = await syncEventDetail(db, eventKey, { force });
    return NextResponse.json(shapeEventDetail(view));
  } catch (err) {
    if (err instanceof WhowatchEventApiError && err.status === 404) {
      return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
    }
    console.error("[whowatch/events/detail]", eventKey, err);
    return NextResponse.json({ error: "イベント詳細を取得できませんでした", detail: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
