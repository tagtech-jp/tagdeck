// ルール本文（rules_text）から当たり倍率表・ボーナス表・無料アイテム配布数を正規表現で抽出する（E3）。
// 表はセルごとに 1 行になる（例: "1%" "20倍" "4%" "10倍" ... "85%"）ため、行の並びをトークン列として読む。
// 抽出できなかった項目は null。全て「推定」であり、UI では (要確認) を付けて表示すること。

export interface MultiplierRow {
  /** 0〜100 の % */
  probability: number;
  multiplier: number;
}

export interface BonusRow {
  grade: string;
  /** 本文に数値が無ければ null（画像で表現されていることがある） */
  point: number | null;
  probability: number | null;
}

export interface FreeItemRule {
  perDay: number;
  /** 「グループ数×N個」表記なら true（総数はグループ数に依存） */
  perGroup: boolean;
  hit: { probability: number; multiplier: number } | null;
}

export interface RulesParsed {
  multiplierTable: MultiplierRow[] | null;
  /** Σ(確率×倍率)。表が無ければ null。通常 = 1 倍 */
  expectedMultiplier: number | null;
  bonusTable: BonusRow[] | null;
  freeItem: FreeItemRule | null;
  parsedAt: string;
  parserVersion: number;
}

export const RULES_PARSER_VERSION = 1;

const PCT_RE = /^(\d+(?:\.\d+)?)\s*[%％]$/;
const MULT_RE = /^(\d+(?:\.\d+)?)\s*倍$/;
const GRADE_WORDS = ["レギュラー", "ビッグ", "メガ", "ギガ", "テラ", "ペタ", "スーパー", "ウルトラ"];

function toLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t　]+/g, " ").trim())
    .filter((l) => l.length > 0);
}

/**
 * 当たり倍率表: 「ランキングポイント倍率」見出し以降で "N%" → "M倍" の並びを拾う。
 * "N%" の直後が倍率でない場合は通常（1 倍）。確率の合計が 100 に達したら打ち切る。
 * 見出しが無い場合は本文全体から最初に成立する表を探す。
 */
export function parseMultiplierTable(text: string): MultiplierRow[] | null {
  const lines = toLines(text);
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (/ランキングポイント倍率|当選確率|倍率表/.test(l)) starts.push(i);
  });
  if (starts.length === 0) starts.push(0);

  for (const start of starts) {
    const rows: MultiplierRow[] = [];
    let sum = 0;
    for (let i = start; i < lines.length && i < start + 60; i++) {
      const pm = lines[i].match(PCT_RE);
      if (!pm) {
        // 表の途中で無関係な文が来たら終了（ただし表がまだ始まっていなければ読み飛ばす）
        if (rows.length > 0 && !MULT_RE.test(lines[i]) && !/通常/.test(lines[i])) break;
        continue;
      }
      const probability = Number(pm[1]);
      const next = lines[i + 1] ?? "";
      const mm = next.match(MULT_RE);
      const multiplier = mm ? Number(mm[1]) : 1;
      rows.push({ probability, multiplier });
      sum += probability;
      if (mm) i++;
      if (sum >= 99.5) break;
    }
    if (rows.length >= 2 && sum >= 99.5 && sum <= 100.5) return rows;
  }
  return null;
}

export function expectedMultiplier(rows: MultiplierRow[] | null): number | null {
  if (!rows || rows.length === 0) return null;
  const e = rows.reduce((acc, r) => acc + (r.probability / 100) * r.multiplier, 0);
  return Math.round(e * 1000) / 1000;
}

/**
 * ボーナス表: 等級語（レギュラー/ビッグ/ギガ…）の行から数行以内の "N%" を確率、"Npt" または "N ポイント" を pt とする。
 */
export function parseBonusTable(text: string): BonusRow[] | null {
  const lines = toLines(text);
  const rows: BonusRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const grade = GRADE_WORDS.find((g) => lines[i] === g || lines[i] === `${g}ボーナス`);
    if (!grade) continue;
    let point: number | null = null;
    let probability: number | null = null;
    for (let j = i; j <= i + 5 && j < lines.length; j++) {
      const l = lines[j];
      const ptm = l.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:pt|ポイント|ﾎﾟｲﾝﾄ)\b/i) ?? l.match(/(\d{1,3}(?:,\d{3})*|\d+)\s*(?:pt|ポイント)/i);
      if (point === null && ptm && !PCT_RE.test(l)) point = Number(ptm[1].replace(/,/g, ""));
      const pm = l.match(PCT_RE) ?? l.match(/(\d+(?:\.\d+)?)\s*[%％]/);
      if (probability === null && pm && j > i) probability = Number(pm[1]);
      if (point !== null && probability !== null) break;
    }
    if (probability !== null || point !== null) rows.push({ grade, point, probability });
  }
  return rows.length > 0 ? rows : null;
}

/** 無料アイテム: 「毎日(グループ数×)N個」と「N%の確率で…M倍」 */
export function parseFreeItem(text: string): FreeItemRule | null {
  const perDay = text.match(/毎日\s*(グループ数\s*[×x]\s*)?(\d+)\s*個/);
  if (!perDay) return null;
  const hit = text.match(/(\d+(?:\.\d+)?)\s*[%％]\s*の確率で[^。\n]{0,20}?(\d+(?:\.\d+)?)\s*倍/);
  return {
    perDay: Number(perDay[2]),
    perGroup: Boolean(perDay[1]),
    hit: hit ? { probability: Number(hit[1]), multiplier: Number(hit[2]) } : null,
  };
}

export function parseRules(text: string | null | undefined, now: Date = new Date()): RulesParsed {
  const t = text ?? "";
  const multiplierTable = parseMultiplierTable(t);
  return {
    multiplierTable,
    expectedMultiplier: expectedMultiplier(multiplierTable),
    bonusTable: parseBonusTable(t),
    freeItem: parseFreeItem(t),
    parsedAt: now.toISOString(),
    parserVersion: RULES_PARSER_VERSION,
  };
}
