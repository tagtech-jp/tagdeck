import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fetchLive, WhowatchLiveApiError } from "@/lib/whowatch/live-feed";

const querySchema = z.object({ liveId: z.string().regex(/^\d{1,20}$/) });

/**
 * GET /api/platforms/whowatch/live/ws?liveId= → コメントサーバ（WebSocket）の接続情報を本人のブラウザへ返す
 * 決裁(2026-09-25): SE のラグを無くすため、/lives/{id} 応答の comment_server_url へブラウザから直接接続する。
 * - 認証必須。jwt は秘密扱いなので、この応答以外（ログ・DB・poll 応答）には一切出さない
 * - DB には触らない（Workers の前景を軽く保つ。ポーリングと同じ）
 * - 接続先が無い配信（応答に comment_server_url が無い）は url=null で返し、ブラウザはポーリングだけで動く
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = querySchema.safeParse({ liveId: new URL(request.url).searchParams.get("liveId") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "liveId（数値）が必要です" }, { status: 400 });

  try {
    const live = await fetchLive(parsed.data.liveId, 0);
    const res = NextResponse.json({ liveId: parsed.data.liveId, url: live.ws.url, jwt: live.ws.jwt, liveStatus: live.liveStatus, serverNow: Date.now() });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    const status = err instanceof WhowatchLiveApiError ? 502 : 500;
    return NextResponse.json({ error: "接続情報を取得できませんでした", detail: err instanceof Error ? err.message : String(err) }, { status });
  }
}
