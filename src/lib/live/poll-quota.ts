// ポーリング回数の見張り(純関数)。
//
// Cloudflare Workers の無料枠は 10 万リクエスト/日で、これを使い切ると tagdeck.jp 全体が止まる。
// 盛り上がり時の間隔を 500ms にすると 1 時間あたり約 6,900 回になり、3 時間配信で約 20,700 回。
// 配信を何本か重ねると枠が見えてくるため、その日の回数を数えて早めに警告する。
//
// 数えているのはブラウザ側の推定値(このタブが送った回数)であって、Cloudflare の実測ではない。
// 複数の端末・タブから接続していれば実際の消費はこれより多い。

/** Cloudflare 無料枠(1 日あたりのリクエスト数) */
export const CLOUDFLARE_FREE_DAILY_LIMIT = 100_000;

/** この回数を超えたら画面で警告する */
export const POLL_WARN_THRESHOLD = 50_000;

export interface PollQuota {
  /** 集計日(ローカル時間の YYYY-MM-DD)。日付が変わったらリセットする */
  date: string;
  count: number;
}

/** ローカル時間の日付キー。日付境界でリセットするために使う */
export function quotaDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 1 回分を加算する。日付が変わっていればそこから数え直す */
export function bumpQuota(prev: PollQuota | null, now: Date): PollQuota {
  const date = quotaDateKey(now);
  if (!prev || prev.date !== date) return { date, count: 1 };
  return { date, count: prev.count + 1 };
}

/** 警告を出すべきか */
export function shouldWarnQuota(quota: PollQuota | null): boolean {
  return (quota?.count ?? 0) >= POLL_WARN_THRESHOLD;
}

/** 保存された値を読み戻す。壊れていたら null(数え直し) */
export function parseQuota(raw: string | null): PollQuota | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== "object" || v === null) return null;
    const { date, count } = v as Partial<PollQuota>;
    if (typeof date !== "string" || typeof count !== "number" || !Number.isFinite(count)) return null;
    return { date, count };
  } catch {
    return null;
  }
}
