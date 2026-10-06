// 連続ギフトの SE 再生キュー。
// 従来は 1 回のポーリングで届いたギフトを同じタイミングで一斉に playSe していたため、
// 同じ音が完全に同位相で重なり「1 件しか鳴っていない」ように聞こえていた。順番に間隔を空けて鳴らす。

/** SE と SE の間隔（前の音が鳴り終わってから次まで） */
export const SE_GAP_MS = 120;
/**
 * 1 件の再生を待つ上限。play() は音が鳴り終わるまで解決しない（engine.playSeUntilEnd）ので、
 * 長い音源でも次を待たせ過ぎないようここで打ち切って次へ進む（音自体は最後まで鳴る）
 */
export const SE_MAX_WAIT_MS = 4_000;
/** これを超えた分は捨てる（暴発防止） */
export const SE_QUEUE_LIMIT = 10;

/**
 * 待ち行列の残り件数から、1 音を何秒で切るか（2026-10-06 社長指示「音の鳴りすぎ対策」）。
 * 有料は捨てずに全部鳴らすため、たまったら 1 音を短くして時間を詰める。null は切らない（最後まで鳴らす）
 */
export const SE_SHORTEN_STEPS: ReadonlyArray<{ backlog: number; maxSeconds: number }> = [
  { backlog: 6, maxSeconds: 1.2 },
  { backlog: 3, maxSeconds: 2 },
];

export function maxSecondsForBacklog(backlog: number): number | null {
  for (const s of SE_SHORTEN_STEPS) if (backlog >= s.backlog) return s.maxSeconds;
  return null;
}

export interface SeQueue<T> {
  push(items: T[]): void;
  /** 接続解除・画面離脱で呼ぶ。未再生分を捨て、再生中のループも止める */
  clear(): void;
  readonly size: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createSeQueue<T>(opts: {
  play: (item: T) => Promise<void>;
  gapMs?: number;
  maxWaitMs?: number;
  limit?: number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * まだ鳴っていない待ち行列の要素に、新着をまとめられるなら合成結果を返す（まとめないなら null）。
   * 同じ人の連投を 1 回の音にするため（2026-10-05）。鳴り始めた要素にはまとめない
   */
  merge?: (queued: T, incoming: T) => T | null;
  /**
   * 上限を超えても捨てない要素（有料ギフト・2026-10-05 社長指示「有料アイテムは捨てずに全部鳴らす」）。
   * 上限を超えたら、捨ててよい要素を新しい方から捨てる。捨てない要素だけで上限を超えるのは許す
   */
  keep?: (item: T) => boolean;
}): SeQueue<T> {
  const { play, gapMs = SE_GAP_MS, maxWaitMs = SE_MAX_WAIT_MS, limit = SE_QUEUE_LIMIT, sleep = defaultSleep, merge, keep } = opts;
  let queue: T[] = [];
  let running = false;
  /** clear() で世代を進め、走っているループを止める */
  let generation = 0;

  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    const gen = generation;
    try {
      while (queue.length > 0 && gen === generation) {
        const item = queue.shift()!;
        await Promise.race([play(item), sleep(maxWaitMs)]);
        if (gen !== generation) return;
        if (queue.length > 0) await sleep(gapMs);
      }
    } finally {
      running = false;
      // clear() 直後に積まれた分など、止まったループの取りこぼしを拾う
      if (queue.length > 0) void drain();
    }
  }

  return {
    push(items: T[]): void {
      if (items.length === 0) return;
      for (const item of items) {
        let merged = false;
        if (merge) {
          for (let i = 0; i < queue.length; i++) {
            const m = merge(queue[i], item);
            if (m !== null) {
              queue[i] = m;
              merged = true;
              break;
            }
          }
        }
        if (!merged) queue.push(item);
      }
      // 上限を超えた分は捨てる（音が延々と続くのを防ぐ）
      if (queue.length > limit) {
        if (!keep) queue = queue.slice(0, limit);
        else {
          for (let i = queue.length - 1; i >= 0 && queue.length > limit; i--) {
            if (!keep(queue[i])) queue.splice(i, 1);
          }
        }
      }
      void drain();
    },
    clear(): void {
      generation++;
      queue = [];
    },
    get size(): number {
      return queue.length;
    },
  };
}
