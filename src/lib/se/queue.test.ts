import { describe, expect, it, vi } from "vitest";
import { createSeQueue, SE_QUEUE_LIMIT } from "./queue";

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
