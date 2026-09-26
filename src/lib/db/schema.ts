import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, unique, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";

// id は auth.users.id と同一。行は auth.users の AFTER INSERT トリガー
// (drizzle/0009_users_auth_sync.sql) と src/lib/db/ensure-user.ts の両方で保証する。
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // メール無しの OAuth ユーザー（X ログイン等）があるため NULL 許容。一意性は NULL を除く部分インデックス。
    email: text("email"),
    displayName: text("display_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email).where(sql`${t.email} is not null`)],
);

export const streamerProfiles = pgTable("streamer_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  // DB列名は drizzle/0007_whowatch_rename.sql 適用と同時デプロイ必須（適用前の本番に本コードを載せない）
  whowatchUserId: text("whowatch_user_id"),
  kickUsername: text("kick_username"),
  niconicoUserId: text("niconico_user_id"),
  // Whowatch monitoring state
  whowatchLiveId: text("whowatch_live_id"),
  whowatchIsMonitoring: boolean("whowatch_is_monitoring").default(false).notNull(),
  whowatchMonitoringStartedAt: timestamp("whowatch_monitoring_started_at"),
  whowatchLastPolledAt: timestamp("whowatch_last_polled_at"),
  whowatchViewerCount: integer("whowatch_viewer_count").default(0).notNull(),
  whowatchCurrentPoints: integer("whowatch_current_points").default(0).notNull(),
  whowatchPeakViewerCount: integer("whowatch_peak_viewer_count").default(0).notNull(),
  // Kick monitoring state（フェーズ 4b）
  kickChannelId: text("kick_channel_id"),
  kickChatroomId: text("kick_chatroom_id"),
  kickIsMonitoring: boolean("kick_is_monitoring").default(false).notNull(),
  kickIsLive: boolean("kick_is_live").default(false).notNull(),
  kickMonitoringStartedAt: timestamp("kick_monitoring_started_at"),
  kickViewerCount: integer("kick_viewer_count").default(0).notNull(),
  kickPeakViewerCount: integer("kick_peak_viewer_count").default(0).notNull(),
  kickFollowerCount: integer("kick_follower_count").default(0).notNull(),
  kickLastEventAt: timestamp("kick_last_event_at"),
  // ニコ生監視状態（フェーズ 4c MVP）
  niconicoProgramId: text("niconico_program_id"),
  niconicoCommunityId: text("niconico_community_id"),
  niconicoIsMonitoring: boolean("niconico_is_monitoring").default(false).notNull(),
  niconicoIsLive: boolean("niconico_is_live").default(false).notNull(),
  niconicoMonitoringStartedAt: timestamp("niconico_monitoring_started_at"),
  niconicoLastPolledAt: timestamp("niconico_last_polled_at"),
  niconicoViewerCount: integer("niconico_viewer_count").default(0),
  niconicoCommentCount: integer("niconico_comment_count").default(0),
  niconicoPeakViewerCount: integer("niconico_peak_viewer_count").default(0),
  niconicoTitle: text("niconico_title"),
  niconicoStartedAt: timestamp("niconico_started_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const listeners = pgTable("listeners", {
  id: uuid("id").primaryKey().defaultRandom(),
  streamerId: uuid("streamer_id").references(() => streamerProfiles.id).notNull(),
  platform: text("platform").notNull(), // 'whowatch' | 'kick' | 'niconico'
  platformUserId: text("platform_user_id").notNull(),
  displayName: text("display_name"),
  nickname: text("nickname"),
  notes: text("notes"),
  totalGiftAmount: integer("total_gift_amount").default(0),
  totalCommentCount: integer("total_comment_count").default(0),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  streamerId: uuid("streamer_id").references(() => streamerProfiles.id).notNull(),
  listenerId: uuid("listener_id").references(() => listeners.id),
  platform: text("platform").notNull(),
  eventType: text("event_type").notNull(), // 'comment' | 'gift' | 'enter' | 'leave'
  payload: jsonb("payload"),
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  streamId: text("stream_id"),
  platformCommentId: text("platform_comment_id"),
  moderated: boolean("moderated").default(false),
});

// イベント勝率シミュレーター（フェーズ 5a）
export const eventSimulators = pgTable("event_simulators", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),

  name: text("name").notNull(),
  platform: text("platform").notNull().default("whowatch"),

  // イベントタイプ: 'score' | 'ranking' | 'nice' | 'viewer'
  eventType: text("event_type").notNull().default("score"),

  // 目標（タイプ別）
  targetScore: integer("target_score"),
  targetRank: integer("target_rank"),

  // ランキング型用
  eventRankingUrl: text("event_ranking_url"),
  myEntryName: text("my_entry_name"),

  // ふわっちイベント紐付け (whowatch_events.id / 手動入力時は null)
  whowatchEventId: integer("whowatch_event_id"),
  // ランキング区分キー（例: autumncollection_1st_overall）。drizzle/0010_event_detail.sql で追加
  rankingType: text("ranking_type"),

  // 期間
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),

  status: text("status").notNull().default("active"),

  // 進捗
  currentScore: integer("current_score").default(0).notNull(),
  currentRank: integer("current_rank"),
  manualScore: integer("manual_score"),

  // 自分のペース履歴
  paceHistory: jsonb("pace_history")
    .$type<Array<{ timestamp: string; score: number }>>()
    .default(sql`'[]'::jsonb`)
    .notNull(),

  // ライバル最新スナップショット（自動取得）
  rivalsSnapshot: jsonb("rivals_snapshot")
    .$type<{
      timestamp: string;
      rivals: Array<{ rank: number; name: string; score: number; paceMean?: number; paceStdDev?: number }>;
    } | null>()
    .default(null),

  // ライバル履歴（最新 20 件）
  rivalsHistory: jsonb("rivals_history")
    .$type<Array<{ timestamp: string; rivals: Array<{ rank: number; name: string; score: number }> }>>()
    .default(sql`'[]'::jsonb`)
    .notNull(),

  // 手動入力ライバル（自動取得失敗時のフォールバック）
  manualRivals: jsonb("manual_rivals")
    .$type<Array<{ name: string; score: number; targetScore?: number }>>()
    .default(sql`'[]'::jsonb`)
    .notNull(),

  // 最終モンテカルロ計算結果キャッシュ
  lastSimulation: jsonb("last_simulation")
    .$type<{
      timestamp: string;
      rankProbability: number;
      expectedRank: number;
      rankDistribution: Record<string, number>;
    } | null>()
    .default(null),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ランキングスナップショット（E2）。公開 API /rankings/{type} の取得結果を append-only で残す。
// drizzle/0011_ranking_snapshots.sql で作成。simulator 削除時は連鎖削除（DELETE /api/events/[id] を壊さない）
export const rankingSnapshots = pgTable(
  "ranking_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    simulatorId: uuid("simulator_id")
      .references(() => eventSimulators.id, { onDelete: "cascade" })
      .notNull(),
    rankingType: text("ranking_type").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
    // API の status: 1=開催中, 3=終了（不明は null）
    status: integer("status"),
    entries: jsonb("entries")
      .$type<Array<{ rank: number; point: number; user_id: string | null; user_path: string | null; name: string; total_view_count: number | null }>>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    myRank: integer("my_rank"),
    myPoint: integer("my_point"),
  },
  (t) => [index("ranking_snapshots_simulator_captured_idx").on(t.simulatorId, t.capturedAt)],
);

// イベント別アイテム基礎ポイント（E3）。全ユーザー共有。source: 'manual'（手入力）| 'estimated'（実測から推定）
// drizzle/0013_event_item_points.sql で作成。UNIQUE(event_key, item_id)
export const eventItemPoints = pgTable(
  "event_item_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventKey: text("event_key").notNull(),
    itemId: text("item_id").notNull(),
    basePoint: integer("base_point").notNull(),
    source: text("source").notNull().default("manual"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("event_item_points_event_item_unique").on(t.eventKey, t.itemId)],
);

// ふわっちアイテムパターン（/playitems・当たり判定に必須）。S1。drizzle/0014_live_cockpit.sql
export const whowatchItemPatterns = pgTable(
  "whowatch_item_patterns",
  {
    patternId: integer("pattern_id").primaryKey(),
    itemId: integer("item_id").notNull(),
    itemName: text("item_name").notNull(),
    patternName: text("pattern_name").notNull(),
    quantity: integer("quantity"),
    // 名前ベースの推定（要確認）
    isHit: boolean("is_hit").default(false).notNull(),
    hitGrade: text("hit_grade"),
    isVariant: boolean("is_variant").default(false).notNull(),
    imageUrl: text("image_url"),
    animationUrl: text("animation_url"),
    // animation_url2 が無くても全画面演出のパターンがあるため両方を持つ（0015）
    animationFullscreen: boolean("animation_fullscreen").default(false).notNull(),
    soundUrl: text("sound_url"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("whowatch_item_patterns_item_idx").on(t.itemId)],
);

// ふわっちアイテムのカテゴリ（/playitems/payments3 のカテゴリ見出し）。SEタブの仕分け 第2弾。drizzle/0016_item_groups.sql
// 1 アイテムが複数カテゴリに同時所属するため (item_id, group_key) の複合主キー（実測: item_id 11146 が 4 カテゴリ）
export const whowatchItemGroups = pgTable(
  "whowatch_item_groups",
  {
    itemId: integer("item_id").notNull(),
    groupKey: text("group_key").notNull(),
    groupTitle: text("group_title").notNull(),
    // 同じ title で中身が違うカテゴリの内訳（例: ステージアップアイテムパックの「〜ぶたさん」「〜ゾウ」）
    subGroupTitle: text("sub_group_title"),
    // 「期間限定」「タイムセール」等。販売期間の日付は API に含まれない（2026-09-22 実応答で確認）
    badgeText: text("badge_text"),
    // アイテムページの並び順
    displayOrder: integer("display_order"),
    // whowatch_events に実在するイベントにだけ入れる（恒常カテゴリは null）
    eventKey: text("event_key"),
    // アイテムページのバナー画像 URL（0017）。payments3 にフィールドが無ければ null（SE タブは文字の見出しで代替）
    bannerUrl: text("banner_url"),
    // カテゴリの説明文（0017）。無ければ null
    description: text("description"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.groupKey] })],
);

// アイテムの 1 個あたりの単価（2026-09-26・drizzle/0020）。/playitems/payments3 の商品（1 個/5 個/10 個…）から
// unit_price_jpy = 最小個数の商品の price ÷ quantity（定価の単価）、min_unit_price_jpy = まとめ買いの最安単価。
// item_point_mapping.price_jpy（最初の商品の価格・Python 日次同期）は予備として残す
export const whowatchItemPrices = pgTable("whowatch_item_prices", {
  itemId: integer("item_id").primaryKey(),
  itemName: text("item_name").default("").notNull(),
  unitPriceJpy: integer("unit_price_jpy").notNull(),
  minUnitPriceJpy: integer("min_unit_price_jpy").notNull(),
  onSale: boolean("on_sale").default(true).notNull(),
  products: jsonb("products")
    .$type<Array<{ productId: string; price: number; quantity: number; state: string }>>()
    .default(sql`'[]'::jsonb`)
    .notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
});

// SE 割り当て（S1）。key: "pattern:{id}" | "item:{id}" | "tier:{T0..T4|hit}"。url が null なら既定合成音で volume/enabled だけ適用
// コンボ機能の廃止前に保存された "tier:combo" の行が残っている場合があるが、解決時に参照されないため放置している
export const seMappings = pgTable(
  "se_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    key: text("key").notNull(),
    url: text("url"),
    // 0〜100
    volume: integer("volume").default(80).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    label: text("label"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("se_mappings_user_key_unique").on(t.userId, t.key)],
);

// SE プリセット（S2・2026-09-25）: se_mappings の一式に名前を付けて保存し、8 文字の共有コードで他ユーザーが取り込めるようにする。
// mappings は保存時点のスナップショット。音源 URL は所有者の Storage（バケット se は公開読み取り）をそのまま指し、複製しない
export const sePresets = pgTable("se_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  shareCode: text("share_code").notNull().unique("se_presets_share_code_unique"),
  // true なら「みんなのプリセット」一覧に出す。false でもコードを知っていれば取り込める
  isPublic: boolean("is_public").default(false).notNull(),
  mappings: jsonb("mappings")
    .$type<Array<{ key: string; url: string | null; volume: number; enabled: boolean; label: string | null }>>()
    .default(sql`'[]'::jsonb`)
    .notNull(),
  mappingCount: integer("mapping_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 過去イベント履歴（フェーズ 5b でベイズ推定に使用）
export const eventHistory = pgTable("event_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  eventId: uuid("event_id"), // 元の event_simulators.id（削除されても保持）

  name: text("name").notNull(),
  platform: text("platform").notNull(),
  eventType: text("event_type").notNull(),

  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),

  finalScore: integer("final_score"),
  finalRank: integer("final_rank"),
  targetScore: integer("target_score"),
  targetRank: integer("target_rank"),
  achieved: boolean("achieved").default(false).notNull(),

  // 全ペース履歴（ベイズ推定用）
  fullPaceHistory: jsonb("full_pace_history")
    .$type<Array<{ timestamp: string; score: number }>>()
    .default(sql`'[]'::jsonb`),

  // ライバル最終結果
  finalRivals: jsonb("final_rivals")
    .$type<Array<{ rank: number; name: string; score: number }>>()
    .default(sql`'[]'::jsonb`),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// アイテムポイントマッピング（Phase 5c 基準値層・全ユーザー共有公開データ）
// UNIQUE(platform, item_id) は supabase_phase5c_item_mapping.sql で定義
// 拡張カラム(product_id 等)は supabase_phase5c_extension.sql の ALTER TABLE で追加
export const itemPointMapping = pgTable("item_point_mapping", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull(), // 'whowatch' | 'niconico'
  itemId: text("item_id").notNull(),
  itemName: text("item_name").notNull(),
  basePoint: integer("base_point").notNull(),
  productId: text("product_id").notNull().default(""),
  priceJpy: integer("price_jpy").notNull().default(0),
  whowatchId: integer("whowatch_id").notNull().default(0),
  description: text("description"),
  hasAnimation: boolean("has_animation").notNull().default(false),
  state: text("state").notNull().default("OPEN"),
  lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),
});

// ふわっちイベント一覧（events route のオンデマンド同期で更新。旧 n8n 日次同期は廃止済み）
// DB列 title_ja / started_at は drizzle/0008_whowatch_event_title.sql 適用と同時デプロイ必須
export const whowatchEvents = pgTable("whowatch_events", {
  id: integer("id").primaryKey(),
  eventKey: text("event_key").notNull(),
  bannerUrl: text("banner_url").notNull().default(""),
  status: text("status").notNull().default("open"), // 'pre' | 'open' | 'closed'
  badgeText: text("badge_text"),
  badgeColor: text("badge_color"),
  badgeAnimation: boolean("badge_animation").default(false),
  // started_at / ended_at は API では epoch ミリ秒。取得時に Date へ変換して格納
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  participants: text("participants"),
  // events/{event_key} ページから抽出した日本語イベント名のキャッシュ（未取得は null）
  titleJa: text("title_ja"),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  // ── 以下 drizzle/0010_event_detail.sql で追加（GET /event_lists/{key} 等の詳細キャッシュ）──
  name: text("name"),
  shortName: text("short_name"),
  // 'daily' (ended_at - started_at < 36h) | 'long' | null(期間不明)
  kind: text("kind"),
  // RANKING タブの detail（/resources/json/rankings/{prefix} と /rankings/{prefix}_... の prefix）
  rankingPrefix: text("ranking_prefix"),
  // /resources/json/rankings/{prefix} の応答そのまま
  struct: jsonb("struct").$type<Record<string, unknown> | null>().default(null),
  // NOTIFICATION タブ（概要）の body HTML と、全 NOTIFICATION をテキスト化したもの
  rulesHtml: text("rules_html"),
  rulesText: text("rules_text"),
  // E3 rules-parser の抽出結果（未抽出は null）
  rulesParsed: jsonb("rules_parsed").$type<Record<string, unknown> | null>().default(null),
  detailFetchedAt: timestamp("detail_fetched_at", { withTimezone: true }),
  // E1b: 区分（前半/後半・グループ）ごとの期間。drizzle/0012_event_periods.sql で追加
  periods: jsonb("periods")
    .$type<Array<{ option_key: string; label: string; starts_at: string; ends_at: string; source: "rules" | "estimated" }> | null>()
    .default(null),
});

export const youtubeOAuthTokens = pgTable('youtube_oauth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  streamerProfileId: uuid('streamer_profile_id').notNull().references(() => streamerProfiles.id, { onDelete: 'cascade' }),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  tokenType: text('token_type').notNull().default('Bearer'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  scope: text('scope'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique('youtube_tokens_user_streamer_unique').on(table.userId, table.streamerProfileId),
]);
