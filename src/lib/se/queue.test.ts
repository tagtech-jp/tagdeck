import { describe, expect, it, vi } from "vitest";
import { createSeQueue, maxSecondsForBacklog, SE_QUEUE_LIMIT } from "./queue";

/** 待ち時間は即解決にして順序と回数だけを見る */
const noSleep = async () => {};

function harness(overrides: Partial<Parameters<typeof createSeQueue<string>>[0]> = {}) {
  const played: string[] = [];
  const play = vi.fn(async (item: string) => {
    played.push(item);
  });
  const queue = createSeQueue<string>({ play, sleep: noSleep, ...overrides });
  return { queue, played, play };
}

/** マイクロタスクを消化する（drain は非同期に進むため） */
const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};

/** SE 間の間隔(0ms)は即時、最大待ち(1000ms)は発火させない = 「再生完了を待つ」状態を再現する */
const waitForPlay = (ms: number) => (ms >= 1000 ? new Promise<void>(() => {}) : Promise.resolve());

describe("createSeQueue", () => {
  it("3 件同時なら 3 回鳴る", async () => {
    const { queue, played } = harness();
    queue.push(["a", "b", "c"]);
    await flush();
    expect(played).toEqual(["a", "b", "c"]);
    expect(queue.size).toBe(0);
  });

  it("同じアイテムが 3 連続でも回数ぶん鳴る", async () => {
    const { queue, played } = harness();
    queue.push(["pig", "pig", "pig"]);
    await flush();
    expect(played).toEqual(["pig", "pig", "pig"]);
  });

  it("15 件同時なら先頭 10 件だけ鳴り、残りは捨てる", async () => {
    const { queue, played } = harness();
    queue.push(Array.from({ length: 15 }, (_, i) => `g${i}`));
    await flush();
    expect(played).toHaveLength(SE_QUEUE_LIMIT);
    expect(played[0]).toBe("g0");
    expect(played.at(-1)).toBe(`g${SE_QUEUE_LIMIT - 1}`);
    expect(queue.size).toBe(0);
  });

  it("再生中に追加しても順番を守る", async () => {
    const played: string[] = [];
    let release: (() => void) | null = null;
    const queue = createSeQueue<string>({
      play: async (item) => {
        played.push(item);
        if (item === "first") await new Promise<void>((r) => (release = r));
      },
      gapMs: 0,
      maxWaitMs: 1000,
      sleep: waitForPlay,
    });
    queue.push(["first"]);
    await flush();
    expect(played).toEqual(["first"]);

    queue.push(["second", "third"]);
    await flush();
    // first の再生が終わるまで次に進まない
    expect(played).toEqual(["first"]);

    release!();
    await flush();
    expect(played).toEqual(["first", "second", "third"]);
  });

  it("clear でキューが空になり、以降は鳴らない", async () => {
    const played: string[] = [];
    let release: (() => void) | null = null;
    const queue = createSeQueue<string>({
      play: async (item) => {
        played.push(item);
        if (item === "a") await new Promise<void>((r) => (release = r));
      },
      gapMs: 0,
      maxWaitMs: 1000,
      sleep: waitForPlay,
    });
    queue.push(["a", "b", "c"]);
    await flush();
    expect(played).toEqual(["a"]);
    expect(queue.size).toBe(2);

    queue.clear();
    expect(queue.size).toBe(0);
    release!();
    await flush();
    expect(played).toEqual(["a"]);
  });

  it("空配列を積んでも何も起きない", async () => {
    const { queue, played, play } = harness();
    queue.push([]);
    await flush();
    expect(played).toEqual([]);
    expect(play).not.toHaveBeenCalled();
  });

  it("再生が最大待ち時間を超えても次に進む", async () => {
    const played: string[] = [];
    const queue = createSeQueue<string>({
      // 解決しない再生（長い音源のダウンロード等）を模す
      play: async (item) => {
        played.push(item);
        await new Promise<void>(() => {});
      },
      sleep: noSleep,
      maxWaitMs: 1,
    });
    queue.push(["x", "y"]);
    await flush();
    expect(played).toEqual(["x", "y"]);
  });
});

describe("createSeQueue の merge（同じ人の連投をまとめる）", () => {
  // "user:個数" の文字列で表す。同じ user ならまとめる
  const merge = (a: string, b: string) => {
    const [ua, na] = a.split(":");
    const [ub, nb] = b.split(":");
    return ua === ub ? `${ua}:${Number(na) + Number(nb)}` : null;
  };

  it("まだ鳴っていない同じ人の分は 1 件にまとめ、別の人は別に鳴らす", async () => {
    const { queue, played } = harness({ merge });
    queue.push(["x:1"]); // 鳴り始める（待ち行列からは出ている）
    queue.push(["a:1", "b:1", "a:2", "a:3"]);
    expect(queue.size).toBe(2);
    await flush();
    expect(played).toEqual(["x:1", "a:6", "b:1"]);
  });

  it("鳴り始めた分にはまとめない", async () => {
    const { queue, played } = harness({ merge });
    queue.push(["a:1"]);
    queue.push(["a:1"]);
    await flush();
    expect(played).toEqual(["a:1", "a:1"]);
  });

  it("merge なしなら従来どおり全件積む", async () => {
    const { queue, played } = harness();
    queue.push(["a:1", "a:1"]);
    await flush();
    expect(played).toEqual(["a:1", "a:1"]);
  });
});

describe("createSeQueue の keep（上限を超えても捨てない要素）", () => {
  it("上限を超えたら捨ててよい要素を新しい方から捨て、keep の要素は全部残す", async () => {
    const { queue, played } = harness({ limit: 3, keep: (s) => s.startsWith("paid") });
    queue.push(["x"]); // 鳴り始める（待ち行列からは出ている）
    queue.push(["free1", "paid1", "free2", "paid2", "free3", "paid3", "paid4"]);
    expect(queue.size).toBe(4); // 上限 3 を超えるが、有料 4 件は捨てない
    await flush();
    expect(played).toEqual(["x", "paid1", "paid2", "paid3", "paid4"]);
  });

  it("keep なしなら従来どおり上限で切る", async () => {
    const { queue, played } = harness({ limit: 2 });
    queue.push(["a", "b", "c", "d"]);
    await flush();
    expect(played).toEqual(["a", "b"]);
  });
});

describe("maxSecondsForBacklog（待ち行列がたまったら 1 音を短くする）", () => {
  it("2 件までは切らず、3〜5 件は 2 秒、6 件以上は 1.2 秒", () => {
    expect(maxSecondsForBacklog(0)).toBeNull();
    expect(maxSecondsForBacklog(2)).toBeNull();
    expect(maxSecondsForBacklog(3)).toBe(2);
    expect(maxSecondsForBacklog(5)).toBe(2);
    expect(maxSecondsForBacklog(6)).toBe(1.2);
    expect(maxSecondsForBacklog(40)).toBe(1.2);
  });
});
