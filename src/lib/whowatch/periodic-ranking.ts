// 期間が切り替わるランキング（periodic ranking）の共通層（2026-10-07 社長指示「WGP のランキングも対応して、ナイスも対応して」）。
// ブラウザからも読み込むのでサーバ専用の import はしない。
//
// 対象の 3 家族（family）と、ふわっち Web 版が使う公開 API（2026-10-07 実測・認証なし）:
//   limited-item … 期間限定アイテム型（黄金発掘隊など）。実装は limited-item.ts（E7）。デイリー = 毎日 0:00 JST 区切り
//   wgp          … WhoWatch GRAND PRIX（/event_lists/{YYYY_MM_whowatchgrandprix} の RANKING タブは type WGP_RANKING・detail 空）。
//                  GET /wgp/ranking/{YYYYMMDD}（デイリー・毎日 0:00 区切り・月に一度だけ 1 位になれる）、
//                  GET /wgp/ranking/overall/{YYYYMM}（月間総合・21 日 0:00 から公開。それまでは rankings が空）。
//                  応答は { title, year, month, day?, status(0=開催前,1=開催中,3=最終結果), is_fixed, rankings:[{ user{id,user_path,name}, rank, point, total_view_count }] }
//   n1           … N-1 グランプリ（/event_lists/nice_one_ranking の RANKING タブ detail = "n1"。構造 JSON は Z-002 で無い）。
//                  GET /rankings/nice_one_{1st|2nd|3rd}_{male|female|rookie}/{YYYYMM}?detail=true と GET /rankings/nice_one_total/{YYYYMM}?detail=true。
//                  期間別は 1 回目 1〜10 日・2 回目 11〜20 日・3 回目 21 日〜月末（0:00 JST 区切り）、全期間は 1 か月。部門は本人の属性
//                  （性別・ルーキー = 開催月 1 日 0 時点で累計配信 100 時間未満）で、公開 API からは分からない
//
// 種別（ranking_type）の表し方（limited-item.ts と同じ考え方: 保存は期間なし、取得・記録は期間つき）:
//   wgp-daily / wgp-overall                  → wgp-daily-YYYYMMDD / wgp-overall-YYYYMM
//   n1-male / n1-female / n1-rookie / n1-total → n1-male-YYYYMM-1st / n1-total-YYYYMM
//   期間は取得する時に「今（JST）」をシミュレーターの期間に収めて決める（1 回ぶんの期間なら、終わった後に取得が走ってもその回の順位表）。

import {
  currentLimitedItemWindow,
  dailySimulatorWindow,
  isLimitedItemPrefix,
  jstDateKey,
  jstDateKeyToDate,
  jstDayWindow,
  limitedItemInitFromStruct,
  parseLimitedItemRankingType,
  resolveLimitedItemRankingType,
} from "./limited-item";
import { jstDate } from "./periods";

// ── 期間の切り替え方（scheme） ────────────────────────────────────────────────

/**
 * daily   = 毎日 0:00 JST（limited-item のグループ・WGP デイリー）
 * n1round = N-1 の期間別（1〜10 日・11〜20 日・21 日〜月末。0:00 JST 区切り）
 * monthly = 1 か月（WGP 総合・N-1 全期間。1 日 0:00 〜 翌月 1 日 0:00 JST）
 * whole   = 期間の切り替えなし（limited-item の総合 = イベント通し）
 */
export type PeriodScheme = "daily" | "n1round" | "monthly" | "whole";

export interface PeriodWindow {
  start: Date;
  end: Date;
  /** 期間キー（YYYYMMDD / YYYYMM-1st / YYYYMM）。whole は null */
  key: string | null;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const N1_ROUNDS = ["1st", "2nd", "3rd"] as const;
export type N1Round = (typeof N1_ROUNDS)[number];

/** JST の年月（YYYYMM） */
export function jstMonthKey(d: Date): string {
  const t = new Date(d.getTime() + JST_OFFSET_MS);
  return `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

function jstParts(d: Date): { year: number; month: number; day: number } {
  const t = new Date(d.getTime() + JST_OFFSET_MS);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** YYYYMM → その月の 1 日 0:00 JST と翌月 1 日 0:00 JST */
export function jstMonthWindow(monthKey: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})(\d{2})$/.exec(monthKey);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { start: jstDate(year, month, 1, 0, 0), end: jstDate(year, month + 1, 1, 0, 0) };
}

/** d を含む JST の月（1 日 0:00 〜 翌月 1 日 0:00） */
export function jstMonthWindowAt(d: Date): PeriodWindow {
  const key = jstMonthKey(d);
  const w = jstMonthWindow(key)!;
  return { ...w, key };
}

/** N-1 の期間別: d を含む回（1st = 1〜10 日、2nd = 11〜20 日、3rd = 21 日〜月末） */
export function n1RoundAt(d: Date): { round: N1Round; monthKey: string } {
  const { day } = jstParts(d);
  return { round: day <= 10 ? "1st" : day <= 20 ? "2nd" : "3rd", monthKey: jstMonthKey(d) };
}

/** N-1 の回の期間。1st = 1 日 0:00〜11 日 0:00、2nd = 11 日〜21 日、3rd = 21 日〜翌月 1 日 0:00（JST） */
export function n1RoundWindow(monthKey: string, round: N1Round): PeriodWindow | null {
  const m = /^(\d{4})(\d{2})$/.exec(monthKey);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const idx = N1_ROUNDS.indexOf(round);
  if (idx < 0) return null;
  const start = jstDate(year, month, 1 + idx * 10, 0, 0);
  const end = idx === 2 ? jstDate(year, month + 1, 1, 0, 0) : jstDate(year, month, 11 + idx * 10, 0, 0);
  return { start, end, key: `${monthKey}-${round}` };
}

/** 期間キー → 期間。形が合わなければ null */
export function periodWindowOfKey(scheme: PeriodScheme, key: string): PeriodWindow | null {
  if (scheme === "daily") {
    const start = jstDateKeyToDate(key);
    if (!start) return null;
    const w = jstDayWindow(start);
    return { start: w.start, end: w.end, key: w.dateKey };
  }
  if (scheme === "monthly") {
    const w = jstMonthWindow(key);
    return w ? { ...w, key } : null;
  }
  if (scheme === "n1round") {
    const m = /^(\d{6})-(1st|2nd|3rd)$/.exec(key);
    return m ? n1RoundWindow(m[1], m[2] as N1Round) : null;
  }
  return null;
}

/** t を含む期間（whole は null） */
export function periodWindowAt(scheme: PeriodScheme, t: Date): PeriodWindow | null {
  if (scheme === "daily") {
    const w = jstDayWindow(t);
    return { start: w.start, end: w.end, key: w.dateKey };
  }
  if (scheme === "monthly") return jstMonthWindowAt(t);
  if (scheme === "n1round") {
    const r = n1RoundAt(t);
    return n1RoundWindow(r.monthKey, r.round);
  }
  return null;
}

/**
 * 開始日時を手で変えたときの終了 = 開始を含む期間の終わり（daily なら翌 0:00 JST、n1round なら回の終わり、monthly なら翌月 1 日 0:00）。
 * whole は null（追従しない）
 */
export function periodEndAfter(scheme: PeriodScheme, start: Date): Date | null {
  return periodWindowAt(scheme, start)?.end ?? null;
}

/**
 * これより長い期間のシミュレーターは「1 期間ぶん」ではない（利用者が全期間などを手で設定した）とみなす。
 * daily は 36 時間（computeEventKind のデイリー判定と同じ幅）、n1round は 12 日（最長の 3 回目 = 11 日 + 余裕）、monthly は 32 日
 */
export function periodMaxSpanMs(scheme: PeriodScheme): number {
  if (scheme === "daily") return 36 * 60 * 60 * 1000;
  if (scheme === "n1round") return 12 * 24 * 60 * 60 * 1000;
  if (scheme === "monthly") return 32 * 24 * 60 * 60 * 1000;
  return Number.POSITIVE_INFINITY;
}

/**
 * シミュレーターの既定の期間 = now を含む期間。イベントの期間（bounds）があればその中に収める（開始前なら最初の期間、終了後なら最後の期間）。
 * daily は limited-item.ts の dailySimulatorWindow と同じ
 */
export function defaultPeriodWindow(scheme: PeriodScheme, now: Date, bounds: { start?: Date | null; end?: Date | null } = {}): PeriodWindow {
  if (scheme === "daily") {
    const w = dailySimulatorWindow(now, bounds);
    return { start: w.start, end: w.end, key: w.dateKey };
  }
  const s = bounds.start && Number.isFinite(bounds.start.getTime()) ? bounds.start : null;
  const e = bounds.end && Number.isFinite(bounds.end.getTime()) ? bounds.end : null;
  let t = now.getTime();
  if (s && t < s.getTime()) t = s.getTime();
  if (e && t >= e.getTime()) t = e.getTime() - 1;
  const w = periodWindowAt(scheme, new Date(t));
  if (!w) {
    // whole: イベントの期間そのもの（無ければ now の 1 日）
    const day = jstDayWindow(now);
    return { start: s ?? day.start, end: e ?? day.end, key: null };
  }
  const start = s ? new Date(Math.max(w.start.getTime(), s.getTime())) : w.start;
  const end = e ? new Date(Math.min(w.end.getTime(), e.getTime())) : w.end;
  return { start, end: end.getTime() > start.getTime() ? end : w.end, key: w.key };
}

/** 期間の切り替え方の説明（画面の注記） */
export function periodSchemeLabel(scheme: PeriodScheme): string {
  if (scheme === "daily") return "デイリー・毎日 0:00 区切り";
  if (scheme === "n1round") return "期間別・1 日/11 日/21 日の 0:00 区切り";
  if (scheme === "monthly") return "月間・1 日 0:00 〜 翌月 1 日 0:00";
  return "期間通し";
}

/** 期間ボタンの文言（now を含む 1 期間。日付は JST） */
export function periodButtonLabel(scheme: PeriodScheme, now: Date = new Date()): string {
  if (scheme === "daily") return "今日の 24 時間（0:00〜翌 0:00）";
  const w = periodWindowAt(scheme, now);
  const fmt = (d: Date) => {
    const p = jstParts(d);
    return `${p.month}/${p.day}`;
  };
  if (scheme === "n1round" && w) return `今の回（${fmt(w.start)} 0:00〜${fmt(w.end)} 0:00）`;
  if (scheme === "monthly" && w) return `今月（${fmt(w.start)} 0:00〜${fmt(w.end)} 0:00）`;
  return "今の期間";
}

/** 開始日時欄の注記（1 期間の入れ方のとき） */
export function periodStartHint(scheme: PeriodScheme): string {
  if (scheme === "daily") return "今日の 0:00 に自動設定";
  if (scheme === "n1round") return "今の回の始まりに自動設定";
  if (scheme === "monthly") return "今月 1 日 0:00 に自動設定";
  return "自動設定";
}

/** 終了日時欄の注記（1 期間の入れ方のとき。開始を変えると期間の終わりに追従する） */
export function periodEndHint(scheme: PeriodScheme): string {
  if (scheme === "daily") return "開始日の翌日 0:00 に自動で追従";
  if (scheme === "n1round") return "回の終わり（11 日・21 日・翌月 1 日の 0:00）に自動で追従";
  if (scheme === "monthly") return "翌月 1 日 0:00 に自動で追従";
  return "自動で追従";
}

// ── WGP ─────────────────────────────────────────────────────────────────────

/** WGP の RANKING タブ（type WGP_RANKING）に付ける擬似 prefix。/event_lists/{key} の detail は空なので、こちらで決める */
export const WGP_PREFIX = "wgp";
/** /event_lists/{key} のタブの type */
export const WGP_TAB_TYPE = "WGP_RANKING";
/** whowatch_events.struct に入れるキー（{ wgp: { eventKey, year, month } }。区分の構造 JSON の代わり） */
export const WGP_STRUCT_KEY = "wgp";
export type WgpDivision = "daily" | "overall";

export function isWgpPrefix(prefix: string | null | undefined): boolean {
  return typeof prefix === "string" && prefix.toLowerCase() === WGP_PREFIX;
}

/** event_key（2026_10_whowatchgrandprix）→ 開催月の YYYYMM。形が違えば null */
export function wgpMonthKeyFromEventKey(eventKey: string | null | undefined): string | null {
  const m = /^(\d{4})_(\d{1,2})_whowatchgrandprix$/i.exec(eventKey ?? "");
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}${String(month).padStart(2, "0")}`;
}

export function buildWgpRankingType(division: WgpDivision, periodKey?: string | null): string {
  const base = `${WGP_PREFIX}-${division}`;
  return periodKey ? `${base}-${periodKey}` : base;
}

/** 公開 API のパス。デイリーは /wgp/ranking/YYYYMMDD、総合は /wgp/ranking/overall/YYYYMM */
export function wgpRankingPath(division: WgpDivision, periodKey: string): string {
  return division === "overall" ? `/wgp/ranking/overall/${periodKey}` : `/wgp/ranking/${periodKey}`;
}

// ── N-1 グランプリ ───────────────────────────────────────────────────────────

/** /event_lists/nice_one_ranking の RANKING タブの detail */
export const N1_PREFIX = "n1";
export const N1_STRUCT_KEY = "n1";
export const N1_DIVISIONS = ["male", "female", "rookie", "total"] as const;
export type N1Division = (typeof N1_DIVISIONS)[number];
/** 部門の自動判定で順に見る部門（全期間は本人の属性に依らないので含めない） */
export const N1_SCAN_DIVISIONS: readonly N1Division[] = ["male", "female", "rookie"];

const N1_DIVISION_LABELS: Record<N1Division, string> = {
  male: "男性部門",
  female: "女性部門",
  rookie: "ルーキー部門（開催月 1 日時点で累計配信 100 時間未満）",
  total: "全期間（1 か月の総 Nice 数）",
};

export function isN1Prefix(prefix: string | null | undefined): boolean {
  return typeof prefix === "string" && prefix.toLowerCase() === N1_PREFIX;
}

export function buildN1RankingType(division: N1Division, periodKey?: string | null): string {
  const base = `${N1_PREFIX}-${division}`;
  return periodKey ? `${base}-${periodKey}` : base;
}

/** 公開 API の種別（nice_one_1st_male / nice_one_total）と月。periodKey は YYYYMM-1st か YYYYMM */
export function n1ApiRankingType(division: N1Division, periodKey: string): { apiType: string; monthKey: string } | null {
  if (division === "total") {
    return /^\d{6}$/.test(periodKey) ? { apiType: "nice_one_total", monthKey: periodKey } : null;
  }
  const m = /^(\d{6})-(1st|2nd|3rd)$/.exec(periodKey);
  return m ? { apiType: `nice_one_${m[2]}_${division}`, monthKey: m[1] } : null;
}

// ── 3 家族をまとめて扱う ─────────────────────────────────────────────────────

export type PeriodicFamily = "limited-item" | "wgp" | "n1";

export interface PeriodicRankingType {
  family: PeriodicFamily;
  /** 保存形（期間なし） */
  baseType: string;
  /** 区分: limited-item はグループ番号か overall、wgp は daily / overall、n1 は male / female / rookie / total */
  division: string;
  scheme: PeriodScheme;
  /** 期間キー。保存形なら null */
  periodKey: string | null;
}

const WGP_TYPE_RE = /^wgp-(daily|overall)(?:-(\d{8}|\d{6}))?$/i;
const N1_TYPE_RE = /^n1-(male|female|rookie|total)(?:-(\d{6}(?:-(?:1st|2nd|3rd))?))?$/i;

/** 3 家族のどれかなら解釈する。従来の種別（autumncollection_1st_overall 等）は null */
export function parsePeriodicRankingType(type: string | null | undefined): PeriodicRankingType | null {
  if (!type) return null;
  const li = parseLimitedItemRankingType(type);
  if (li) {
    const base = li.group === "overall" ? `limited-item-${li.eventKey}-overall` : `limited-item-${li.eventKey}-${li.group}`;
    return {
      family: "limited-item",
      baseType: base,
      division: String(li.group),
      scheme: li.group === "overall" ? "whole" : "daily",
      periodKey: li.group === "overall" ? null : li.period,
    };
  }
  const w = WGP_TYPE_RE.exec(type);
  if (w) {
    const division = w[1].toLowerCase() as WgpDivision;
    const scheme: PeriodScheme = division === "overall" ? "monthly" : "daily";
    const key = w[2] ?? null;
    // デイリーは 8 桁、総合は 6 桁だけ
    if (key && ((scheme === "daily" && key.length !== 8) || (scheme === "monthly" && key.length !== 6))) return null;
    return { family: "wgp", baseType: buildWgpRankingType(division), division, scheme, periodKey: key };
  }
  const n = N1_TYPE_RE.exec(type);
  if (n) {
    const division = n[1].toLowerCase() as N1Division;
    const scheme: PeriodScheme = division === "total" ? "monthly" : "n1round";
    const key = n[2] ?? null;
    if (key && ((scheme === "monthly" && key.length !== 6) || (scheme === "n1round" && key.length !== 10))) return null;
    return { family: "n1", baseType: buildN1RankingType(division), division, scheme, periodKey: key };
  }
  return null;
}

/** 種別の期間の切り替え方。3 家族でなければ null */
export function periodicSchemeOf(type: string | null | undefined): PeriodScheme | null {
  return parsePeriodicRankingType(type)?.scheme ?? null;
}

/**
 * 区分が未設定（空 = 自動判定）のときも含め、prefix と種別から期間の切り替え方を決める。
 * limited-item は daily（総合を選べば whole）、wgp は daily（総合を選べば monthly）、n1 は n1round（全期間を選べば monthly）。3 家族でなければ null
 */
export function periodicSchemeFor(prefix: string | null | undefined, rankingType: string | null | undefined): PeriodScheme | null {
  const parsed = parsePeriodicRankingType(rankingType);
  if (parsed) return parsed.scheme;
  if (isLimitedItemPrefix(prefix)) return "daily";
  if (isWgpPrefix(prefix)) return "daily";
  if (isN1Prefix(prefix)) return "n1round";
  return null;
}

export function isPeriodicPrefix(prefix: string | null | undefined): boolean {
  return isLimitedItemPrefix(prefix) || isWgpPrefix(prefix) || isN1Prefix(prefix);
}

/** 区分を「自動判定」で空のまま作れる家族（本人の属性で決まる区分: limited-item のグループ・N-1 の部門） */
export function hasAutoDivision(prefix: string | null | undefined): boolean {
  return isLimitedItemPrefix(prefix) || isN1Prefix(prefix);
}

function clampToWindow(t: Date, window: { start: Date; end: Date } | null | undefined): Date {
  if (!window) return t;
  return new Date(Math.min(Math.max(t.getTime(), window.start.getTime()), window.end.getTime() - 1));
}

/**
 * 保存形の種別 → その時点で取得すべき期間つきの種別。期間つきならそのまま。3 家族でなければそのまま返す。
 * 期間は now をシミュレーターの期間（window）に収めて決める
 */
export function resolvePeriodicRankingType(type: string, now: Date, window?: { start: Date; end: Date } | null): string {
  const p = parsePeriodicRankingType(type);
  if (!p) return type;
  if (p.family === "limited-item") return resolveLimitedItemRankingType(type, now, window);
  if (p.periodKey) return type;
  if (p.scheme === "whole") return type;
  const w = periodWindowAt(p.scheme, clampToWindow(now, window));
  if (!w?.key) return type;
  return p.family === "wgp" ? buildWgpRankingType(p.division as WgpDivision, w.key) : buildN1RankingType(p.division as N1Division, w.key);
}

/**
 * 画面で「今の区切り」として使う期間: 期間が切り替わる種別は now を含む期間とシミュレーターの期間の重なり、
 * 切り替わらない種別（whole）はシミュレーターの期間そのもの。3 家族でなければ null
 */
export function currentPeriodicWindow(now: Date, sim: { startTime: Date; endTime: Date }, type: string | null | undefined): PeriodWindow | null {
  const p = parsePeriodicRankingType(type);
  if (!p) return null;
  if (p.family === "limited-item") {
    const li = parseLimitedItemRankingType(type)!;
    const w = currentLimitedItemWindow(now, sim, li.group);
    return { start: w.start, end: w.end, key: w.dateKey };
  }
  if (p.scheme === "whole") return { start: sim.startTime, end: sim.endTime, key: null };
  const w = periodWindowAt(p.scheme, clampToWindow(now, { start: sim.startTime, end: sim.endTime }))!;
  return {
    start: new Date(Math.max(w.start.getTime(), sim.startTime.getTime())),
    end: new Date(Math.min(w.end.getTime(), sim.endTime.getTime())),
    key: w.key,
  };
}

// ── 区分の選択肢（events.ts の RankingChoice と同じ形） ───────────────────────

export interface PeriodicChoice {
  rankingType: string;
  label: string;
  parts: string[];
  border: Array<{ rank: number }>;
}

/** WGP: デイリー（既定 = 先頭）と月間総合。デイリー 1 位 = 5 万 pt（月に一度だけ）、総合 1〜3 位 = 100 万/30 万/20 万 pt（概要本文 2026-10） */
export function wgpChoices(): PeriodicChoice[] {
  return [
    { rankingType: buildWgpRankingType("daily"), label: "デイリー（毎日 0:00 区切り・1 位 5 万 pt）", parts: ["daily"], border: [{ rank: 1 }] },
    { rankingType: buildWgpRankingType("overall"), label: "月間総合（21 日 0:00 から公開・1〜3 位入賞）", parts: ["overall"], border: [{ rank: 3 }] },
  ];
}

/** N-1: 男性・女性・ルーキー（期間別）と全期間。どれも上位 10 名が入賞 */
export function n1Choices(): PeriodicChoice[] {
  return N1_DIVISIONS.map((d) => ({ rankingType: buildN1RankingType(d), label: N1_DIVISION_LABELS[d], parts: [d], border: [{ rank: 10 }] }));
}

/** wgp / n1 の prefix なら選択肢を返す（struct は要らない）。それ以外は null（limited-item は events.ts 側で struct から作る） */
export function periodicChoices(prefix: string | null | undefined): PeriodicChoice[] | null {
  if (isWgpPrefix(prefix)) return wgpChoices();
  if (isN1Prefix(prefix)) return n1Choices();
  return null;
}

/** 種別の表示名（部門名など）。3 家族でなければ null */
export function periodicChoiceLabel(type: string | null | undefined): string | null {
  const p = parsePeriodicRankingType(type);
  if (!p) return null;
  if (p.family === "wgp") return wgpChoices().find((c) => c.rankingType === p.baseType)?.label ?? p.baseType;
  if (p.family === "n1") return N1_DIVISION_LABELS[p.division as N1Division] ?? p.baseType;
  return null;
}

/**
 * 本人が居る区分を探すときに見る「兄弟」の種別（保存形）。今の種別は含めない。
 * limited-item は struct（初期化 JSON）のグループ、n1 は男性・女性・ルーキー。wgp と総合系は無し
 */
export function periodicSiblingTypes(type: string, struct: unknown): string[] {
  const p = parsePeriodicRankingType(type);
  if (!p || p.scheme === "whole" || p.scheme === "monthly") return [];
  if (p.family === "limited-item") {
    const li = parseLimitedItemRankingType(type)!;
    const init = limitedItemInitFromStruct(struct);
    if (!init) return [];
    return init.groups.filter((g) => g.id !== li.group).map((g) => `limited-item-${li.eventKey}-${g.id}`);
  }
  if (p.family === "n1") return N1_SCAN_DIVISIONS.filter((d) => d !== p.division).map((d) => buildN1RankingType(d));
  return [];
}

// ── イベントの期間（/event_lists に日付が無い家族） ─────────────────────────

/**
 * WGP は event_key の開催月（1 日 0:00 〜 翌月 1 日 0:00 JST）、N-1 は常設なので now を含む月。
 * endsAt は「翌 0:00」。whowatch_events.ended_at の慣例（23:59:59 JST）に合わせるなら呼び出し側で 1 秒引く。該当しなければ null
 */
export function periodicEventSchedule(prefix: string | null | undefined, eventKey: string | null | undefined, now: Date): { startsAt: Date; endsAt: Date } | null {
  if (isWgpPrefix(prefix)) {
    const key = wgpMonthKeyFromEventKey(eventKey) ?? jstMonthKey(now);
    const w = jstMonthWindow(key);
    return w ? { startsAt: w.start, endsAt: w.end } : null;
  }
  if (isN1Prefix(prefix)) {
    const w = jstMonthWindowAt(now);
    return { startsAt: w.start, endsAt: w.end };
  }
  return null;
}

/** 常設で終わりが無い家族（N-1。期間の自動進行でイベントの終了を見ない）。種別が空なら prefix で判定する */
export function isPerpetualFamily(type: string | null | undefined, prefix?: string | null): boolean {
  const p = parsePeriodicRankingType(type);
  return p ? p.family === "n1" : isN1Prefix(prefix);
}

/** 今日の JST 日付キー（再 export。画面の鍵に使う） */
export { jstDateKey };
