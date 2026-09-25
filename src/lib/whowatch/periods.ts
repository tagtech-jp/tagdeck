// E1b: ロングイベントの区分（前半/後半・グループ）ごとの期間を rules_text から抽出する。
// 一次情報: /event_lists の started_at/ended_at は全体期間のみ。区分は /resources/json/rankings/{prefix} の options[]。
// 区分ごとの日付は概要タブ本文（例「ランキング＜前半＞」「2026年9月18日（金）0:00 ～」「2026年9月22日（火）24:00」）にある。
// 「24:00」は翌日 00:00 JST に正規化。年が省略された日付は直前の日付の年を引き継ぐ。純関数のみ。

export interface PeriodOption {
  key: string;
  value?: string;
}

export interface EventPeriod {
  option_key: string;
  label: string;
  /** ISO 8601（UTC）。JST 00:00 は前日 15:00Z */
  starts_at: string;
  ends_at: string;
  source: "rules" | "estimated";
}

const JST_OFFSET_MS = 9 * 3600 * 1000;

/** JST の年月日時分 → Date（UTC）。24:00 は翌日 00:00 に正規化 */
export function jstDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const ms = Date.UTC(year, month - 1, day, hour, minute) - JST_OFFSET_MS; // 24:00 は Date.UTC が翌日に繰り上げる
  return new Date(ms);
}

interface DateToken {
  year: number | null;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

// 例: "2026年9月18日（金）0:00" / "9月22日(火)24:00" / "2026年9月23日（水）00:00"
const DATE_TOKEN_RE = /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:[（(][^）)]*[）)])?\s*(\d{1,2}):(\d{2})/g;

function tokenize(text: string): DateToken[] {
  const out: DateToken[] = [];
  for (const m of text.matchAll(DATE_TOKEN_RE)) {
    out.push({ year: m[1] ? Number(m[1]) : null, month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) });
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * ラベル（options[].value）の直後にある日付範囲を抽出する。
 * ラベルは「＜前半＞」「<前半>」「（前半）」「【前半】」のいずれかで囲まれた行を探し、
 * その行から最大 4 行以内に現れる最初の 2 つの日時トークンを開始・終了とする。
 * @param fallbackYear 年省略時の初期値（直前の日付があればそちらを優先）
 */
export function extractPeriodsFromRules(
  rulesText: string,
  options: PeriodOption[],
  fallbackYear: number | null,
): Map<string, { starts_at: Date; ends_at: Date }> {
  const lines = rulesText.split(/\r?\n/).map((l) => l.replace(/[ \t　]+/g, " ").trim());
  const found = new Map<string, { starts_at: Date; ends_at: Date }>();
  let lastYear: number | null = fallbackYear;

  for (const opt of options) {
    const label = (opt.value ?? "").trim();
    if (!label) continue;
    const labelRe = new RegExp(`[＜<（(【\\[]\\s*${escapeRe(label)}\\s*[＞>）)】\\]]`);
    for (let i = 0; i < lines.length; i++) {
      if (!labelRe.test(lines[i])) continue;
      const window = lines.slice(i, i + 5).join(" ");
      const tokens = tokenize(window);
      if (tokens.length < 2) continue;
      const [a, b] = tokens;
      const ya = a.year ?? lastYear;
      if (ya === null) continue;
      const yb = b.year ?? ya;
      const starts = jstDate(ya, a.month, a.day, a.hour, a.minute);
      const ends = jstDate(yb, b.month, b.day, b.hour, b.minute);
      if (ends.getTime() <= starts.getTime()) continue;
      found.set(opt.key, { starts_at: starts, ends_at: ends });
      lastYear = yb;
      break;
    }
  }
  return found;
}

/**
 * 区分ごとの期間を確定する。rules から取れた区分は source:'rules'、
 * 取れなかった区分は全体期間（overallStart〜overallEnd）を options 数で等分して source:'estimated'。
 * 全体期間が無ければ estimated は作れない（rules 由来のみ返す）。
 */
export function resolveEventPeriods(
  rulesText: string | null | undefined,
  options: PeriodOption[] | null | undefined,
  overall: { startsAt: Date | null; endsAt: Date | null },
): EventPeriod[] {
  const opts = (options ?? []).filter((o) => o && o.key);
  if (opts.length === 0) return [];
  const fallbackYear = overall.startsAt?.getUTCFullYear() ?? null;
  const fromRules = extractPeriodsFromRules(rulesText ?? "", opts, fallbackYear);

  const out: EventPeriod[] = [];
  const canEstimate = overall.startsAt && overall.endsAt && overall.endsAt.getTime() > overall.startsAt.getTime();
  const totalMs = canEstimate ? overall.endsAt!.getTime() - overall.startsAt!.getTime() : 0;
  const sliceMs = canEstimate ? totalMs / opts.length : 0;

  opts.forEach((opt, idx) => {
    const label = opt.value ?? opt.key;
    const hit = fromRules.get(opt.key);
    if (hit) {
      out.push({ option_key: opt.key, label, starts_at: hit.starts_at.toISOString(), ends_at: hit.ends_at.toISOString(), source: "rules" });
      return;
    }
    if (!canEstimate) return;
    const s = new Date(overall.startsAt!.getTime() + sliceMs * idx);
    const e = idx === opts.length - 1 ? overall.endsAt! : new Date(overall.startsAt!.getTime() + sliceMs * (idx + 1));
    out.push({ option_key: opt.key, label, starts_at: s.toISOString(), ends_at: e.toISOString(), source: "estimated" });
  });
  return out;
}
