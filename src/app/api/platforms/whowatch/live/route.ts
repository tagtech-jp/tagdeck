import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { streamerProfiles } from "@/lib/db/schema";
import { fetchLiveId, normalizeWhowatchUserPath, WhowatchLiveApiError } from "@/lib/whowatch/live-feed";
import { isSameWhowatchUser } from "@/lib/whowatch/same-user";

/** 正規化後に API へ渡すパスとして安全か（?userId= は設定に保存せず一時的に他の配信者を見るための入力） */
const SAFE_PROFILE_PATH = /^(?:[wt]:)?[A-Za-z0-9_]+$/;

/**
 * GET /api/platforms/whowatch/live → 配信中 live_id（S1・ライブページ用）
 * 既定は設定の自分のふわっちID。?userId= を渡すと一時的にそのユーザーを見る（isOther=true・記録しない）。
 * ユーザー不在（found=false）と非配信（found=true・liveId=null）を区別して返す。
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requested = new URL(request.url).searchParams.get("userId")?.trim() || null;
  if (requested) {
    const { candidates } = normalizeWhowatchUserPath(requested);
    if (candidates.length === 0 || !candidates.every((c) => SAFE_PROFILE_PATH.test(c))) {
      return NextResponse.json({ error: "配信者IDの形式が正しくありません", found: false, isLive: false, liveId: null }, { status: 400 });
    }
  }

  // 自分のIDを手入力した場合に他人扱いしないよう、?userId= があっても自分のIDは引く
  const db = createDbClient();
  const [profile] = await db.select({ whowatchUserId: streamerProfiles.whowatchUserId }).from(streamerProfiles).where(eq(streamerProfiles.userId, user.id)).limit(1);
  const ownId = profile?.whowatchUserId ?? null;

  let target = requested;
  if (!target) {
    if (!ownId) return NextResponse.json({ error: "ふわっちユーザーIDが未設定です（設定 → プラットフォーム）", found: false, isLive: false, liveId: null }, { status: 400 });
    target = ownId;
  }

  try {
    const r = await fetchLiveId(target);
    if (!r.found) {
      return NextResponse.json(
        { error: "このIDのユーザーが見つかりません。ふわっちのプロフィールURLを貼り付けてもかまいません", found: false, isLive: false, liveId: null, whowatchUserId: target },
        { status: 404 },
      );
    }
    const res = NextResponse.json({
      found: true,
      isLive: r.liveId !== null,
      liveId: r.liveId,
      title: r.title,
      startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
      displayName: r.displayName,
      userPath: r.userPath,
      whowatchUserId: target,
      isOther: requested !== null && !isSameWhowatchUser(ownId, r.userPath),
    });
    res.headers.set("Cache-Control", "private, max-age=10");
    return res;
  } catch (err) {
    const status = err instanceof WhowatchLiveApiError ? 502 : 500;
    return NextResponse.json({ error: "配信状態を取得できませんでした", detail: err instanceof Error ? err.message : String(err), found: false, isLive: false, liveId: null }, { status });
  }
}
