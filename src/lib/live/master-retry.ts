// アイテムマスタ（/items/patterns）取得のリトライ制御（純関数）。
//
// 対策D でパターン照合をブラウザ側へ移した結果、マスタ取得が 1 回失敗すると
// そのセッション全体が「全部無料扱いの音」になる単一障害点ができた（2026-09-22 本番で発生）。
// 配信中に起きると気づきにくいため、諦めずに取り直す。

/** 失敗のたびに伸びる待ち時間。最後の値に達したら以後はその間隔で叩き続ける */
export const MASTER_RETRY_DELAYS_MS = [5_000, 15_000, 45_000, 120_000, 300_000] as const;

/**
 * 次のリトライまでの待ち時間。
 * 回数の上限は設けない（配信は数時間続くので、途中で諦めると一時障害から復帰できない）。
 * 代わりに間隔の上限を設けて「諦めずに、しかし軽く」叩き続ける。
 *
 * @param failureCount これまでの連続失敗回数（1 回目の失敗後なら 1）
 */
export function masterRetryDelay(failureCount: number): number {
  if (failureCount <= 0) return MASTER_RETRY_DELAYS_MS[0];
  const i = Math.min(failureCount, MASTER_RETRY_DELAYS_MS.length) - 1;
  return MASTER_RETRY_DELAYS_MS[i];
}

export interface MasterState {
  /** マスタが使える状態か（1 件でも読み込めていれば true） */
  ready: boolean;
  /** 連続失敗回数。成功で 0 に戻る */
  failureCount: number;
  /** 次にリトライする時刻。ready のときは null */
  nextRetryAt: number | null;
}

export const INITIAL_MASTER_STATE: MasterState = { ready: false, failureCount: 0, nextRetryAt: null };

/** 取得に成功した。リトライを止めてカウンタを戻す */
export function masterSucceeded(): MasterState {
  return { ready: true, failureCount: 0, nextRetryAt: null };
}

/** 取得に失敗した。次のリトライを予約する */
export function masterFailed(prev: MasterState, now: number): MasterState {
  const failureCount = prev.failureCount + 1;
  return { ready: false, failureCount, nextRetryAt: now + masterRetryDelay(failureCount) };
}

/** 画面表示用。縮退中なら次のリトライまでの残り秒 */
export function retryCountdownSec(state: MasterState, now: number): number | null {
  if (state.ready || state.nextRetryAt === null) return null;
  return Math.max(0, Math.ceil((state.nextRetryAt - now) / 1000));
}
