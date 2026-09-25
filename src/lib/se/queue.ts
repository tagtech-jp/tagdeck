// 連続ギフトの SE 再生キュー。
// 従来は 1 回のポーリングで届いたギフトを同じタイミングで一斉に playSe していたため、
// 同じ音が完全に同位相で重なり「1 件しか鳴っていない」ように聞こえていた。順番に間隔を空けて鳴らす。

/** SE と SE の最小間隔 */
export const SE_GAP_MS = 200;
/** 1 件の再生を待つ上限。長い音源（初回のダウンロードとデコード）で詰まらせない */
export const SE_MAX_WAIT_MS = 1_200;
/** これを超えた分は捨てる（暴発防止） */
export const SE_QUEUE_LIMIT = 10;

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
}): SeQueue<T> {
  const { play, gapMs = SE_GAP_MS, maxWaitMs = SE_MAX_WAIT_MS, limit = SE_QUEUE_LIMIT, sleep = defaultSleep } = opts;
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
      queue.push(...items);
      // 上限を超えた分は捨てる（音が延々と続くのを防ぐ）
      if (queue.length > limit) queue = queue.slice(0, limit);
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
