import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { errorDetail } from "@/lib/error-detail";
import { createClient } from "@/lib/supabase/server";
import { createDbClient } from "@/lib/db/client";
import { events, itemPointMapping, listeners, streamerProfiles, whowatchItemDecorations, whowatchItemGroups, whowatchItemPatterns, whowatchItemPrices } from "@/lib/db/schema";
import { parseDecorations } from "@/lib/se/bulk-grade";
import { fetchLive, isGiftComment, normalizeGift, pickGiftComment, WhowatchLiveApiError, type LiveComment, type PatternInfo } from "@/lib/whowatch/live-feed";

/**
 * パターン情報を一括取得する（価格は item_point_mapping と結合）。対策D でレスポンス後の
 * バックグラウンド（persistGifts）専用になった。SE 再生用の照合はブラウザ側キャッシュが担う。
 */
async function lookupPatterns(db: ReturnType<typeof createDbClient>, patternIds: number[]): Promise<Map<number, PatternInfo>> {
  const lookupMap = new Map<number, PatternInfo>();
  if (patternIds.length === 0) return lookupMap;
  const rows = await db.select().from(whowatchItemPatterns).where(inArray(whowatchItemPatterns.patternId, patternIds));
  const itemIds = [...new Set(rows.map((r) => String(r.itemId)))];
  const itemIdNums = [...new Set(rows.map((r) => r.itemId))];
  const [prices, unitPrices, groupRows, decorationRows] = await Promise.all([
    itemIds.length > 0 ? db.select({ itemId: itemPointMapping.itemId, priceJpy: itemPointMapping.priceJpy }).from(itemPointMapping).where(and(eq(itemPointMapping.platform, "whowatch"), inArray(itemPointMapping.itemId, itemIds))) : Promise.resolve([]),
    // 1 個あたりの単価（2026-09-26）。0020 未適用・未同期なら空で、item_point_mapping.price_jpy に落ちる
    itemIdNums.length > 0 ? db.select({ itemId: whowatchItemPrices.itemId, unitPriceJpy: whowatchItemPrices.unitPriceJpy }).from(whowatchItemPrices).where(inArray(whowatchItemPrices.itemId, itemIdNums)).catch(() => []) : Promise.resolve([]),
    itemIdNums.length > 0 ? db.select({ itemId: whowatchItemGroups.itemId, groupKey: whowatchItemGroups.groupKey, displayOrder: whowatchItemGroups.displayOrder, isFree: whowatchItemGroups.isFree }).from(whowatchItemGroups).where(inArray(whowatchItemGroups.itemId, itemIdNums)) : Promise.resolve([]),
    // まとめ投げの段階しきい値（0022・2026-09-28）。未適用なら空
    itemIdNums.length > 0 ? db.select({ itemId: whowatchItemDecorations.itemId, decorations: whowatchItemDecorations.decorations }).from(whowatchItemDecorations).where(inArray(whowatchItemDecorations.itemId, itemIdNums)).catch(() => []) : Promise.resolve([]),
  ]);
  const decorationsByItem = new Map(decorationRows.map((d) => [d.itemId, parseDecorations(d.decorations)]));
  const priceById = new Map(prices.map((p) => [p.itemId, p.priceJpy]));
  for (const u of unitPrices) priceById.set(String(u.itemId), u.unitPriceJpy);
  // アイテムページの並び順で持つ（resolveMappingKey は渡された順で最初に一致したものを使う）
  const groupsByItem = new Map<number, string[]>();
  for (const g of [...groupRows].sort((a, b) => (a.displayOrder ?? 9999) - (b.displayOrder ?? 9999))) {
    const list = groupsByItem.get(g.itemId);
    if (list) list.push(g.groupKey);
    else groupsByItem.set(g.itemId, [g.groupKey]);
  }
  const freeEventItems = new Set(groupRows.filter((g) => g.isFree).map((g) => g.itemId));
  for (const r of rows) {
    lookupMap.set(r.patternId, { patternId: r.patternId, itemId: r.itemId, itemName: r.itemName, patternName: r.patternName, isHit: r.isHit, hitGrade: r.hitGrade, quantity: r.quantity, priceJpy: priceById.get(String(r.itemId)) ?? null, animationUrl: r.animationUrl, animationFullscreen: r.animationFullscreen, groups: groupsByItem.get(r.itemId) ?? [], freeEvent: freeEventItems.has(r.itemId), decorations: decorationsByItem.get(r.itemId) ?? [] });
  }
  return lookupMap;
}

/**
 * リスナーを探す／無ければ作る（累計 0 で作る）。累計はここでは足さない。
 * 足すのは persistGifts が events への保存に成功したときだけ（同じギフトを 2 回処理しても二重に足さないため）。
 * listeners に UNIQUE(streamer_id, platform, platform_user_id) は無いので、初めてのギフトを 2 か所で同時に処理すると
 * 2 行できうる（従来からの挙動。この場合も events に入れた方の行にだけ足すので、合計は二重にならない）
 */
async function findOrCreateListener(db: ReturnType<typeof createDbClient>, streamerId: string, platformUserId: string, displayName: string | null): Promise<string | null> {
  const [existing] = await db
    .select({ id: listeners.id })
    .from(listeners)
    .where(and(eq(listeners.streamerId, streamerId), eq(listeners.platform, "whowatch"), eq(listeners.platformUserId, platformUserId)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(listeners)
    .values({ streamerId, platform: "whowatch", platformUserId, displayName, lastSeenAt: new Date(), totalGiftAmount: 0 })
    .returning({ id: listeners.id });
  return created?.id ?? null;
}

/**
 * パターン照合＋ listeners / events への保存。ctx.waitUntil() でレスポンス後に実行する。
 * - 照合が失敗しても保存は続ける（パターン列が null の行の方が、行が無いより後から復旧できる）
 * - 1 件の失敗が他の件を止めないよう try/catch を件ごとに掛け、失敗はログに残す（握りつぶさない）
 * - payload.raw にはふわっちAPIの生コメントをそのまま入れる（フィールド名が未確定のため証跡として残す）
 * - 累計（listeners.total_gift_amount）は events に 1 行入ったときだけ足す（2026-10-02）。同じ配信に 2 台以上の
 *   ブラウザが接続していると、同じギフトを各ブラウザの poll が受け取ってここへ来る。以前は events の保存より先に
 *   累計を足していたため、events は部分ユニークで 1 件にまとまるのに、累計は処理した回数だけ増えていた
 */
async function persistGifts(db: ReturnType<typeof createDbClient>, streamerId: string, liveId: string, giftRaw: LiveComment[]): Promise<void> {
  const patternIds = [...new Set(giftRaw.map((c) => c.play_item_pattern_id).filter((v): v is number => typeof v === "number"))];
  let lookupMap = new Map<number, PatternInfo>();
  try {
    lookupMap = await lookupPatterns(db, patternIds);
  } catch (e) {
    // 照合に失敗しても保存自体は続ける。ここで throw すると waitUntil の中なのでログも残らず 1 バッチ丸ごと消える
    console.error("[live/poll] パターン照合に失敗（パターン列なしで保存を続行）", { liveId, error: e instanceof Error ? e.message : String(e) });
  }
  const gifts = giftRaw.map((c) => normalizeGift(c, (id) => lookupMap.get(id) ?? null));
  for (let i = 0; i < gifts.length; i++) {
    const g = gifts[i];
    const raw = giftRaw[i];
    try {
      const listenerId = !g.user.anonymized && g.user.id ? await findOrCreateListener(db, streamerId, g.user.id, g.user.name) : null;
      // 保存と加算は 1 つのトランザクションに入れる（行はあるのに累計が足りない、という片方だけの反映を残さない）
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(events)
          .values({
            streamerId,
            listenerId,
            platform: "whowatch",
            eventType: "gift",
            payload: { ...g, raw } as Record<string, unknown>,
            occurredAt: g.posted_at ? new Date(g.posted_at) : new Date(),
            streamId: liveId,
            platformCommentId: g.comment_id,
          })
          .onConflictDoNothing()
          .returning({ id: events.id });
        // 0 行 = 別のブラウザ（または同じ lastUpdatedAt での取り直し）が保存済み。累計は足さない
        if (inserted.length === 0 || !listenerId) return;
        // 読んでから足すと、同時に動いた 2 件の片方が消える。SQL の中で足す
        await tx
          .update(listeners)
          .set({ lastSeenAt: new Date(), totalGiftAmount: sql`coalesce(${listeners.totalGiftAmount}, 0) + ${g.count}`, ...(g.user.name ? { displayName: g.user.name } : {}) })
          .where(eq(listeners.id, listenerId));
      });
    } catch (e) {
      console.error("[live/poll] バックグラウンド保存に失敗", { liveId, commentId: g.comment_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

const bodySchema = z.object({
  liveId: z.string().regex(/^\d{1,20}$/),
  lastUpdatedAt: z.union([z.number(), z.string()]).optional(),
  /** true なら DB に保存しない（デバッグ表示のみ） */
  dryRun: z.boolean().optional(),
  /** true のときだけ生コメント全件を返す（?debug=1 の学習モード用。既定では返さない） */
  debug: z.boolean().optional(),
  /**
   * ブラウザ側のアイテムマスタが壊れているときだけ送られてくる、照合できなかった pattern_id。
   * 該当分だけをサーバで引いて返す（縮退運転）。正常時は空なので DB には触らない
   */
  needPatterns: z.array(z.number().int().positive()).max(50).optional(),
});

/**
 * POST /api/platforms/whowatch/live/poll → /lives/{id}?last_updated_at= を 1 回取得し、ギフトコメントを返す（S1）
 * - ブラウザは応答の pollingInterval（サーバ指定 10 秒・最短 3 秒）でこれを繰り返す。既存 POST /api/platforms/whowatch/poll は変更しない
 * - 対策D: クリティカルパスで DB を一切引かない。プロフィール取得・パターン照合・保存はすべて
 *   ctx.waitUntil() のバックグラウンドへ寄せてある。postgres.js は遅延接続なので、クエリを 1 本も
 *   出さない回は TCP/TLS/SCRAM のハンドシェイク自体が発生しない（2026-09-22 実測の DB 833ms の正体）
 * - ギフトは events に event_type='gift' / platform_comment_id=comment.id / stream_id=live_id で保存（重複は部分ユニークで弾く）
 * - listeners は platform_user_id で探す／無ければ累計 0 で作る。累計は events に 1 行入ったときだけ SQL の中で足す。匿名は listener_id=null
 * - 生データは payload.raw に保持。jwt は保存も返却もしない
 */
export async function POST(request: Request) {
  // 遅延の内訳を測るための区間計測（?debug=1 の計測モードが timings を表示する）
  const t0 = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tAuth = Date.now();

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "liveId（数値）が必要です" }, { status: 400 });
  const { liveId, lastUpdatedAt = 0, dryRun = false, debug = false, needPatterns = [] } = parsed.data;

  let live;
  try {
    live = await fetchLive(liveId, lastUpdatedAt);
  } catch (err) {
    const status = err instanceof WhowatchLiveApiError ? 502 : 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[live/poll] 配信データの取得に失敗", { liveId, status, error: message });
    return NextResponse.json({ error: "配信データを取得できませんでした", ...errorDetail(message) }, { status });
  }
  const tUpstream = Date.now();

  // 保存には生コメントをそのまま渡す（payload.raw の証跡）。ブラウザへ返す方だけフィールドを絞る
  const giftRaw = live.comments.filter(isGiftComment);
  const giftComments = giftRaw.map(pickGiftComment);

  // 対策A+D: SE 再生に DB は要らない。プロフィール取得（＝接続確立）ごとレスポンス後に回す
  const deferredSave = !dryRun && giftRaw.length > 0;
  if (deferredSave) {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(
      (async () => {
        // 背景処理の所要はレスポンスに載せられない（送出後に確定するため）。ログで追えるようにする
        const bgStart = Date.now();
        const db = createDbClient();
        try {
          const [profile] = await db.select({ id: streamerProfiles.id }).from(streamerProfiles).where(eq(streamerProfiles.userId, user.id)).limit(1);
          if (!profile) {
            console.error("[live/poll] 配信者プロフィールが無いため保存をスキップ", { liveId, userId: user.id });
            return;
          }
          const tProfile = Date.now();
          await persistGifts(db, profile.id, liveId, giftRaw);
          console.log("[live/poll] 背景処理 完了", { liveId, gifts: giftRaw.length, profileMs: tProfile - bgStart, persistMs: Date.now() - tProfile, totalMs: Date.now() - bgStart });
        } catch (e) {
          console.error("[live/poll] バックグラウンド処理に失敗", { liveId, totalMs: Date.now() - bgStart, error: e instanceof Error ? e.message : String(e) });
        }
      })(),
    );
  }

  // 縮退運転: ブラウザのマスタが壊れているときだけ、照合できなかった分をここで引く。
  // 正常時は needPatterns が空なので DB 接続は発生しない（対策D の前景ゼロを保つ）
  let patternInfo: PatternInfo[] = [];
  if (needPatterns.length > 0) {
    console.warn("[live/poll] ブラウザのアイテムマスタが縮退中（サーバ側で照合）", { liveId, userId: user.id, patternIds: needPatterns });
    try {
      // 縮退時だけ接続する（postgres.js は遅延接続なので、ここを通らなければ TCP は開かない）
      const map = await lookupPatterns(createDbClient(), needPatterns);
      patternInfo = [...map.values()];
    } catch (e) {
      console.error("[live/poll] 縮退時のパターン照合に失敗", { liveId, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 時計ズレ補正の基準。ブラウザ側で往復の中点と突き合わせるため、送出直前に打つ
  const serverNow = Date.now();
  return NextResponse.json({
    liveId,
    liveStatus: live.liveStatus,
    updatedAt: live.updatedAt,
    /** Worker 自身の時計（NTP 同期済み）。ふわっちAPIの updated_at は無音区間で古くなるため使わない */
    serverNow,
    /**
     * このWorkerのビルド識別子。ブラウザ側は自分のバンドルに埋め込まれた値と突き合わせ、
     * 食い違えば古いバンドルで動いていると分かる（Service Worker がデプロイ後も古いJSを配り続けるため）
     */
    buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown",
    pollingInterval: live.pollingInterval,
    commentCount: live.comments.length,
    giftComments,
    /** 縮退時だけ入る。ブラウザはこれを自分のキャッシュへ取り込んで判定を続ける */
    patternInfo,
    // 遅延の内訳（ms）。auth=Supabase 認証 / upstream=ふわっちAPI。対策D 以降クリティカルパスに DB は無い
    timings: { total: serverNow - t0, auth: tAuth - t0, upstream: tUpstream - tAuth },
    // true: プロフィール取得＋パターン照合＋保存はレスポンス後のバックグラウンドで実行中（?debug=1 の表示用）
    deferredSave,
    // 学習モード（?debug=1）でだけ生コメント全件を返す。既定で返すと毎回の転送量が増えるうえ
    // ギフト以外のコメントの投稿者情報まで流れてしまう
    rawComments: debug ? live.comments : [],
  });
}
