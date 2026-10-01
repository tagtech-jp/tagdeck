// ランキング区分（rankingType）の選択肢の絞り込みと既定の選び方（2026-10-01）。
// イベント作成フォーム・設定画面（区分・期間を編集）・5 分同期の自動設定（auto-ranking-type.ts）の 3 か所で同じ規則を使う。
// ブラウザでも読み込むので、サーバ専用のモジュールを import しない。

/** 選択肢の最小の形（events.ts の RankingChoice・各画面のローカル型のどちらも満たす） */
export interface ChoiceLike {
  rankingType: string;
  parts: string[];
}

/** 区分ごとの期間の最小の形（periods.ts の EventPeriod と同じキー） */
export interface PeriodLike {
  option_key: string;
  starts_at: string;
  ends_at: string;
}

/** 区分（option_key = 前半 1st / 後半 2nd など）に属する選択肢。区分が無いイベントは全部 */
export function choicesForOption<T extends ChoiceLike>(choices: readonly T[], optionKey: string | null): T[] {
  return optionKey ? choices.filter((c) => c.parts[0] === optionKey) : [...choices];
}

/** 既定の選択肢: 「総合」（selectbox = overall の末端）→ 無ければ先頭 */
export function defaultChoice<T extends ChoiceLike>(choices: readonly T[]): T | null {
  return choices.find((c) => c.parts.length === 2 && c.parts[1] === "overall") ?? choices[0] ?? null;
}

/** at を含む区分（starts_at <= at < ends_at）。無ければ null */
export function periodKeyAt(periods: readonly PeriodLike[], at: Date): string | null {
  const t = at.getTime();
  for (const p of periods) {
    const s = Date.parse(p.starts_at);
    const e = Date.parse(p.ends_at);
    if (Number.isFinite(s) && Number.isFinite(e) && s <= t && t < e) return p.option_key;
  }
  return null;
}

/**
 * 区分が空のシミュレーターに入れる既定の rankingType。
 * 区分（前半/後半）があるイベントは at（シミュレーターの開始日時）を含む区分の「総合」、
 * at がどの区分にも入らなければ、at より前に始まった最後の区分（無ければ最初の区分）。区分が無いイベントは全体の「総合」
 */
export function pickDefaultRankingType<T extends ChoiceLike>(choices: readonly T[], periods: readonly PeriodLike[], at: Date): { rankingType: string; optionKey: string | null } | null {
  if (choices.length === 0) return null;
  let optionKey: string | null = null;
  if (periods.length > 0) {
    optionKey = periodKeyAt(periods, at);
    if (!optionKey) {
      const started = periods.filter((p) => Date.parse(p.starts_at) <= at.getTime());
      optionKey = (started.length > 0 ? started[started.length - 1] : periods[0]).option_key;
    }
  }
  const pick = defaultChoice(choicesForOption(choices, optionKey)) ?? (optionKey ? null : defaultChoice(choices));
  return pick ? { rankingType: pick.rankingType, optionKey } : null;
}
