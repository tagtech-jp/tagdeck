// ふわっちの「期間限定アイテム」型ランキング（limited-item）の純関数（2026-10-07）。ブラウザからも読み込むのでサーバ専用の import はしない。
//
// 例: ふわっち黄金発掘隊（2026_10_gold_digger_1）。/event_lists/{key} の RANKING タブの detail は `limited-item-{event_key}`。
// 従来の構造 JSON（/resources/json/rankings/{prefix}）は Z-002 で取れず、/rankings/{type} も空配列を返す。
// 2026-10-07 実測（ふわっち Web 版が使う公開 API・認証なし）:
//   GET /events/limited_item_rankings_init?event_key=…
//     → { period: "20261007"（今日・JST）, select_boxes: [{ key: "OVERALL" | "20261007", value: "総合ランキング" | "1日目", border: [{rank: 5}], tab_type: "overall" | "daily" }],
//         tabs: { daily: [{ tab_name: "K24", group_id: "1" }, … K10 = "5"], overall: [{ tab_name: "総合ランキング", group_id: "1" }] },
//         event_unit: "kg", is_overall_exists: true, … }
//   GET /events/limited_item_rankings?period=YYYYMMDD|OVERALL&event_key=…&group=N
//     → { rankings: [{ user_id, user_name, user_path, icon_url, rank, point(数値・kg), live_id, … }] }
//   period は JST の日付。デイリーは毎日 0:00 に切り替わり（社長指示「デイリーイベントは 0:00 の 24 時間区切り」）、
//   開始前の日付や period 省略は Z-001、未来の日付は空配列。limit / page は無視される。
//
// ランキング種別（ranking_type）の表し方:
//   保存用（日付なし・event_simulators.ranking_type）:
//     limited-item-{event_key}-{group}   … デイリーのグループ（配信者グレード K24 など）。日付は取得する時に「その日」を付ける
//     limited-item-{event_key}-overall   … 総合ランキング（期間通し）
//   取得・記録用（日付あり・ranking_snapshots.ranking_type）:
//     limited-item-{event_key}-{group}-{YYYYMMDD} / limited-item-{event_key}-1-OVERALL
//   ふわっち Web 版の URL（?rankingType=limited-item-2026_10_gold_digger_1-2-20261007）は後者と同じ形。

import { jstDate } from "./periods";

export const LIMITED_ITEM_PREFIX = "limited-item-";
/** 総合ランキングの period（API はこの大文字表記だけ受け付ける。"overall" は Z-001） */
export const OVERALL_PERIOD = "OVERALL";
/** whowatch_events.struct に初期化 JSON を入れるキー（従来の構造 JSON と見分けるため） */
export const LIMITED_ITEM_STRUCT_KEY = "limited_item";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── 種別（ranking_type）の解釈 ───────────────────────────────────────────────

export function isLimitedItemPrefix(prefix: string | null | undefined): boolean {
  return typeof prefix === "string" && prefix.toLowerCase().startsWith(LIMITED_ITEM_PREFIX);
}

/** `limited-item-{event_key}` → event_key。limited-item でなければそのまま返す */
export function eventKeyFromLimitedItemPrefix(prefix: string): string {
  return isLimitedItemPrefix(prefix) ? prefix.slice(LIMITED_ITEM_PREFIX.length) : prefix;
}

export interface LimitedItemRankingType {
  eventKey: string;
  /** デイリーのグループ番号（1 始まり）か、総合 */
  group: number | "overall";
  /** YYYYMMDD か OVERALL。日付なしの保存形なら null */
  period: string | null;
}

// event_key は英数字と _ だけ（2026_10_gold_digger_1）。group は数字か overall、period は 8 桁の日付か OVERALL
const RANKING_TYPE_RE = /^limited-item-([a-z0-9_]+)-(overall|\d{1,3})(?:-(\d{8}|OVERALL))?$/i;

export function parseLimitedItemRankingType(type: string | null | undefined): LimitedItemRankingType | null {
  if (!type) return null;
  const m = RANKING_TYPE_RE.exec(type);
  if (!m) return null;
  const eventKey = m[1];
  const rawGroup = m[2];
  const period = m[3] ? (m[3].toUpperCase() === OVERALL_PERIOD ? OVERALL_PERIOD : m[3]) : null;
  // 総合の取得形は API のとおり group=1・period=OVERALL（limited-item-{key}-1-OVERALL）
  if (period === OVERALL_PERIOD) return { eventKey, group: "overall", period };
  if (rawGroup.toLowerCase() === "overall") return period ? null : { eventKey, group: "overall", period: null };
  const group = Number(rawGroup);
  if (!Number.isInteger(group) || group < 1) return null;
  return { eventKey, group, period };
}

export function isLimitedItemRankingType(type: string | null | undefined): boolean {
  return parseLimitedItemRankingType(type) !== null;
}

/** ranking_type を組み立てる。period を省くと保存形（日付なし） */
export function buildLimitedItemRankingType(eventKey: string, group: number | "overall", period?: string | null): string {
  if (group === "overall") return period ? `${LIMITED_ITEM_PREFIX}${eventKey}-1-${OVERALL_PERIOD}` : `${LIMITED_ITEM_PREFIX}${eventKey}-overall`;
  const base = `${LIMITED_ITEM_PREFIX}${eventKey}-${group}`;
  return period ? `${base}-${period}` : base;
}

// ── JST の日付境界（0:00 区切り） ─────────────────────────────────────────────

/** JST での日付キー（YYYYMMDD） */
export function jstDateKey(d: Date): string {
  const t = new Date(d.getTime() + JST_OFFSET_MS);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, "0");
  const day = String(t.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** YYYYMMDD（JST）→ その日の 0:00 JST */
export function jstDateKeyToDate(key: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(key);
  if (!m) return null;
  const d = jstDate(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** d を含む JST の 1 日（0:00 〜 翌 0:00） */
export function jstDayWindow(d: Date): { start: Date; end: Date; dateKey: string } {
  const dateKey = jstDateKey(d);
  const start = jstDateKeyToDate(dateKey)!;
  return { start, end: new Date(start.getTime() + DAY_MS), dateKey };
}

/**
 * d の次の 0:00 JST（d がちょうど 0:00 なら翌日の 0:00）。デイリーのシミュレーターの終了 = 開始日の翌日 0:00 に使う
 * （2026-10-07 社長指示「終了日時は開始日の翌日の 0:00 に自動的になるように」）
 */
export function nextJstMidnightAfter(d: Date): Date {
  return jstDayWindow(d).end;
}

/** t を [start, end) に収める（end 以降なら end の直前） */
export function clampTime(t: Date, window: { start: Date; end: Date } | null | undefined): Date {
  if (!window) return t;
  const ms = Math.min(Math.max(t.getTime(), window.start.getTime()), window.end.getTime() - 1);
  return new Date(ms);
}

/**
 * デイリーの period（YYYYMMDD）を決める。シミュレーターの期間（window）があればその中に収めてから日付にする:
 *   期間が 10/7 00:00〜10/8 00:00 のまま 10/8 に取得が走っても、10/7 の順位表を見に行く（翌日の空の表に切り替わらない）
 */
export function resolveLimitedItemPeriod(now: Date, window?: { start: Date; end: Date } | null): string {
  return jstDateKey(clampTime(now, window));
}

/** 保存形の ranking_type → その時点で取得すべき日付つきの種別。limited-item 以外はそのまま返す */
export function resolveLimitedItemRankingType(type: string, now: Date, window?: { start: Date; end: Date } | null): string {
  const p = parseLimitedItemRankingType(type);
  if (!p) return type;
  if (p.group === "overall") return buildLimitedItemRankingType(p.eventKey, "overall", OVERALL_PERIOD);
  return buildLimitedItemRankingType(p.eventKey, p.group, p.period ?? resolveLimitedItemPeriod(now, window));
}

/**
 * 画面で「今日の区切り」として使う期間。デイリーは now を含む JST の 1 日をシミュレーターの期間と重ねた範囲、総合はシミュレーターの期間そのもの
 */
export function currentLimitedItemWindow(
  now: Date,
  sim: { startTime: Date; endTime: Date },
  group: number | "overall",
): { start: Date; end: Date; dateKey: string | null } {
  if (group === "overall") return { start: sim.startTime, end: sim.endTime, dateKey: null };
  const day = jstDayWindow(clampTime(now, { start: sim.startTime, end: sim.endTime }));
  return {
    start: new Date(Math.max(day.start.getTime(), sim.startTime.getTime())),
    end: new Date(Math.min(day.end.getTime(), sim.endTime.getTime())),
    dateKey: day.dateKey,
  };
}

/**
 * デイリーのシミュレーターの既定の期間 = now を含む JST の 1 日（0:00〜翌 0:00）。イベントの期間（bounds）があればその中に収める:
 *   開始前なら 1 日目、終了後なら最終日、途中なら今日。日の境界がイベントの期間をはみ出す分は切る
 * （2026-10-07 社長指示「開始時間と終了時間も自動的に修正して 24 時間で設定できるように」）
 */
export function dailySimulatorWindow(now: Date, bounds: { start?: Date | null; end?: Date | null } = {}): { start: Date; end: Date; dateKey: string } {
  const s = bounds.start && Number.isFinite(bounds.start.getTime()) ? bounds.start : null;
  const e = bounds.end && Number.isFinite(bounds.end.getTime()) ? bounds.end : null;
  let t = now.getTime();
  if (s && t < s.getTime()) t = s.getTime();
  if (e && t >= e.getTime()) t = e.getTime() - 1;
  const day = jstDayWindow(new Date(t));
  const start = s ? new Date(Math.max(day.start.getTime(), s.getTime())) : day.start;
  const end = e ? new Date(Math.min(day.end.getTime(), e.getTime())) : day.end;
  return { start, end: end.getTime() > start.getTime() ? end : day.end, dateKey: day.dateKey };
}

/** ranking_snapshots を「その日の種別」の行だけにする（前日の順位表が混ざるとペース推定が壊れる） */
export function filterSnapshotsForDatedType<T extends { rankingType?: string | null }>(snapshots: readonly T[] | null, datedType: string | null): T[] | null {
  if (snapshots === null) return null;
  if (!datedType) return [...snapshots];
  const wanted = datedType.toLowerCase();
  return snapshots.filter((s) => (s.rankingType ?? "").toLowerCase() === wanted);
}

// ── 初期化 JSON（limited_item_rankings_init） ─────────────────────────────────

export interface LimitedItemGroup {
  id: number;
  /** 表示名（K24 など） */
  name: string;
}

export interface LimitedItemInit {
  /** API が「今日」とみなす period（JST の日付）。無ければ null */
  period: string | null;
  /** デイリーのグループ（group_id 昇順） */
  groups: LimitedItemGroup[];
  hasOverall: boolean;
  /** 単位（kg など）。無ければ null */
  unit: string | null;
  /** 入賞ボーダー順位（select_boxes[].border） */
  border: number[];
  eventName: string | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** 初期化 JSON を正規化する。オブジェクトでない・error_code 付き・グループも総合も無いものは null */
export function normalizeLimitedItemInit(raw: unknown): LimitedItemInit | null {
  const r = asRecord(raw);
  if (!r || ("error_code" in r && r.error_code)) return null;
  const tabs = asRecord(r.tabs) ?? asRecord(r.tab_type_settings);
  const dailyRaw = Array.isArray(tabs?.daily) ? (tabs!.daily as unknown[]) : [];
  const groups: LimitedItemGroup[] = [];
  for (const g of dailyRaw) {
    const gr = asRecord(g);
    const id = Number(gr?.group_id);
    if (!gr || !Number.isInteger(id) || id < 1) continue;
    const name = typeof gr.tab_name === "string" && gr.tab_name.trim() ? gr.tab_name.trim() : `グループ ${id}`;
    groups.push({ id, name });
  }
  groups.sort((a, b) => a.id - b.id);
  const overallRaw = Array.isArray(tabs?.overall) ? (tabs!.overall as unknown[]) : [];
  const hasOverall = r.is_overall_exists === true || overallRaw.length > 0;
  if (groups.length === 0 && !hasOverall) return null;
  const border = new Set<number>();
  for (const sb of Array.isArray(r.select_boxes) ? (r.select_boxes as unknown[]) : []) {
    const sbr = asRecord(sb);
    for (const b of Array.isArray(sbr?.border) ? (sbr!.border as unknown[]) : []) {
      const rank = Number(asRecord(b)?.rank);
      if (Number.isInteger(rank) && rank > 0) border.add(rank);
    }
  }
  return {
    period: typeof r.period === "string" && /^\d{8}$/.test(r.period) ? r.period : null,
    groups,
    hasOverall,
    unit: typeof r.event_unit === "string" && r.event_unit ? r.event_unit : null,
    border: [...border].sort((a, b) => a - b),
    eventName: typeof r.event_name === "string" && r.event_name ? r.event_name : null,
  };
}

/** whowatch_events.struct が limited-item の初期化 JSON を包んだものなら正規化して返す */
export function limitedItemInitFromStruct(struct: unknown): LimitedItemInit | null {
  const r = asRecord(struct);
  if (!r || !(LIMITED_ITEM_STRUCT_KEY in r)) return null;
  return normalizeLimitedItemInit(r[LIMITED_ITEM_STRUCT_KEY]);
}

export interface LimitedItemChoice {
  rankingType: string;
  label: string;
  parts: string[];
  border: Array<{ rank: number }>;
}

/**
 * 区分の選択肢（events.ts の RankingChoice と同じ形）。保存形（日付なし）の種別を返す。
 * parts[0] はグループ番号（"1"〜）か "overall"。前半/後半のような期間の区分（periods）はこの型には無い
 */
export function limitedItemChoices(prefix: string, init: LimitedItemInit): LimitedItemChoice[] {
  const eventKey = eventKeyFromLimitedItemPrefix(prefix);
  const border = init.border.map((rank) => ({ rank }));
  const out: LimitedItemChoice[] = init.groups.map((g) => ({
    rankingType: buildLimitedItemRankingType(eventKey, g.id),
    label: g.name,
    parts: [String(g.id)],
    border,
  }));
  if (init.hasOverall) out.push({ rankingType: buildLimitedItemRankingType(eventKey, "overall"), label: "総合ランキング（期間通し）", parts: ["overall"], border });
  return out;
}

/** 種別の表示名（K20 など）。日付つきでも保存形に戻して探す。選択肢に無ければ種別そのもの、limited-item でなければ null */
export function limitedItemChoiceLabel(type: string | null | undefined, choices: readonly LimitedItemChoice[]): string | null {
  const p = parseLimitedItemRankingType(type);
  if (!p) return null;
  const base = buildLimitedItemRankingType(p.eventKey, p.group);
  return choices.find((c) => c.rankingType === base)?.label ?? (type as string);
}

// ── 概要本文の日程（ランキング（N日目） YYYY年M月D日 00:00 〜 24:00） ─────────────

export interface LimitedItemScheduleDay {
  index: number;
  /** JST の日付キー */
  dateKey: string;
  startsAt: Date;
  endsAt: Date;
}

export interface LimitedItemSchedule {
  days: LimitedItemScheduleDay[];
  /** 最初の日の開始（JST 0:00） */
  startsAt: Date | null;
  /** 最後の日の終了（翌 0:00 JST） */
  endsAt: Date | null;
}

const DAY_LABEL_RE = /ランキング\s*[（(]\s*(\d{1,3})\s*日目\s*[）)]/;
// 例: "2026年10月7日（水） 00:00 〜 24:00"。年が無い行もある。時刻が無ければ 0:00〜24:00 とみなす
const DAY_DATE_RE = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:[（(][^）)]*[）)])?\s*(?:(\d{1,2}):(\d{2})\s*[〜～~\-–]\s*(\d{1,2}):(\d{2}))?/;

/**
 * 概要本文（rules_text）から「ランキング（N日目）」の日程を読む。/event_lists に started_at / ended_at が無いイベント
 * （黄金発掘隊など）の全体期間はここから決める。年が省略されていれば fallbackYear（無ければ直前の日付の年）を使う
 */
export function parseLimitedItemSchedule(rulesText: string | null | undefined, fallbackYear: number | null = null): LimitedItemSchedule {
  const lines = (rulesText ?? "").split(/\r?\n/).map((l) => l.replace(/[ \t　]+/g, " ").trim());
  const days: LimitedItemScheduleDay[] = [];
  let lastYear = fallbackYear;
  for (let i = 0; i < lines.length; i++) {
    const label = DAY_LABEL_RE.exec(lines[i]);
    if (!label) continue;
    // 見出しの行から 3 行以内の最初の日付
    for (let j = i; j < Math.min(lines.length, i + 4); j++) {
      const m = DAY_DATE_RE.exec(lines[j]);
      if (!m) continue;
      const year = m[1] ? Number(m[1]) : lastYear;
      if (year === null) break;
      const month = Number(m[2]);
      const day = Number(m[3]);
      const sh = m[4] !== undefined ? Number(m[4]) : 0;
      const sm = m[5] !== undefined ? Number(m[5]) : 0;
      const eh = m[6] !== undefined ? Number(m[6]) : 24;
      const em = m[7] !== undefined ? Number(m[7]) : 0;
      const startsAt = jstDate(year, month, day, sh, sm);
      const endsAt = jstDate(year, month, day, eh, em);
      if (!Number.isFinite(startsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) break;
      days.push({ index: Number(label[1]), dateKey: jstDateKey(startsAt), startsAt, endsAt });
      lastYear = year;
      break;
    }
  }
  // 目次と本文で同じ「N日目」が 2 回出る本文は先勝ち
  const seen = new Set<number>();
  const unique = days.filter((d) => (seen.has(d.index) ? false : (seen.add(d.index), true))).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return {
    days: unique,
    startsAt: unique[0]?.startsAt ?? null,
    endsAt: unique.length > 0 ? unique[unique.length - 1].endsAt : null,
  };
}
