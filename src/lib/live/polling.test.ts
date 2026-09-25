import { describe, expect, it } from "vitest";
import { ACTIVE_WINDOW_MS, MIN_POLL_DELAY_MS, nextPollDelay, partitionFreshGifts, POLL_INTERVAL_MS, pollIntervalFor } from "./polling";

const gift = (id: string) => ({ comment_id: id });
const NOW = 1_800_000_000_000;

// 注意: ここの入力 isOther は「他人の配信か」の算出済みの結果でしかない。
// 実際に対策Fが効かなかった原因は、自分のIDを手入力すると isOther=true になる
// /live ルート側の判定ミスで、この層のテストでは検出できなかった。
// 算出そのものは same-user.test.ts で担保する。
describe("pollIntervalFor（対策F: 盛り上がっている時だけ短くする）", () => {
  it("ギフトから 30 秒経過していても、60 秒以内なら active のまま", () => {
    // 実機で「10 秒間隔（最後のギフトから 30 秒）」と表示された事象の再現ケース
    expect(pollIntervalFor({ isOther: false, serverIntervalMs: 10_000, lastGiftAt: NOW - 30_000, now: NOW })).toBe(POLL_INTERVAL_MS.active);
  });

  it("ふわっちが返す 10 秒指定は active を上書きしない", () => {
    // polling_interval は常に 10000 で返るため、ここで上書きされると対策Fが死ぬ
    expect(pollIntervalFor({ isOther: false, serverIntervalMs: POLL_INTERVAL_MS.idle, lastGiftAt: NOW - 30_000, now: NOW })).toBe(POLL_INTERVAL_MS.active);
  });

  it("直近 60 秒以内にギフトがあれば 3 秒", () => {
    expect(pollIntervalFor({ isOther: false, serverIntervalMs: 10_000, lastGiftAt: NOW - 1_000, now: NOW })).toBe(POLL_INTERVAL_MS.active);
    // 境界: ちょうど 60 秒はまだ active
    expect(pollIntervalFor({ isOther: false, serverIntervalMs: 10_000, lastGiftAt: NOW - ACTIVE_WINDOW_MS, now: NOW })).toBe(POLL_INTERVAL_MS.active);
  });

  it("最後のギフトから 60 秒を過ぎたら 10 秒に戻る", () => {
    expect(pollIntervalFor({ isOther: false, serverIntervalMs: 10_000, lastGiftAt: NOW - ACTIVE_WINDOW_MS - 1, now: NOW })).toBe(POLL_INTERVAL_MS.idle);
  });

  it("まだ 1 件もギフトが無ければ 10 秒", () => {
    expect(pollIntervalFor({ isOther: false, serverIntervalMs: 10_000, lastGiftAt: null, now: NOW })).toBe(POLL_INTERVAL_MS.idle);
  });

  it("他人の配信は、直後にギフトがあっても常に 10 秒", () => {
    expect(pollIntervalFor({ isOther: true, serverIntervalMs: 10_000, lastGiftAt: NOW - 1_000, now: NOW })).toBe(POLL_INTERVAL_MS.other);
    expect(pollIntervalFor({ isOther: true, serverIntervalMs: 10_000, lastGiftAt: null, now: NOW })).toBe(POLL_INTERVAL_MS.other);
  });

  it("サーバが 10 秒より長い間隔を指示したら、盛り上がっていてもそちらに従う", () => {
    expect(pollIntervalFor({ isOther: false, serverIntervalMs: 30_000, lastGiftAt: NOW - 1_000, now: NOW })).toBe(30_000);
    expect(pollIntervalFor({ isOther: true, serverIntervalMs: 30_000, lastGiftAt: null, now: NOW })).toBe(30_000);
  });

  it("ギフトが続く間は 3 秒を維持し、途切れたら 10 秒へ戻る", () => {
    // 盛り上がり中 → ギフトが来るたび lastGiftAt が更新される
    expect(pollIntervalFor({ isOther: false, serverIntervalMs: 10_000, lastGiftAt: NOW, now: NOW + 30_000 })).toBe(POLL_INTERVAL_MS.active);
    expect(pollIntervalFor({ isOther: false, serverIntervalMs: 10_000, lastGiftAt: NOW + 30_000, now: NOW + 50_000 })).toBe(POLL_INTERVAL_MS.active);
    // 最後のギフトから 60 秒超 → idle
    expect(pollIntervalFor({ isOther: false, serverIntervalMs: 10_000, lastGiftAt: NOW + 30_000, now: NOW + 95_000 })).toBe(POLL_INTERVAL_MS.idle);
  });
});

describe("nextPollDelay", () => {
  it("取得にかかった分を差し引いて固定レートにする", () => {
    expect(nextPollDelay(5_000, 800)).toBe(4_200);
  });
  it("取得が間隔を超えても最低待ち時間は空ける", () => {
    expect(nextPollDelay(5_000, 6_000)).toBe(MIN_POLL_DELAY_MS);
  });
});

describe("partitionFreshGifts", () => {
  it("接続直後の 1 回目は画面には出すが SE は鳴らさない", () => {
    const r = partitionFreshGifts([gift("a"), gift("b")], new Set(), true);
    expect(r.fresh.map((g) => g.comment_id)).toEqual(["a", "b"]);
    expect(r.toPlay).toEqual([]);
  });
  it("2 回目以降は新着だけ鳴らす", () => {
    const r = partitionFreshGifts([gift("a"), gift("c")], new Set(["a"]), false);
    expect(r.fresh.map((g) => g.comment_id)).toEqual(["c"]);
    expect(r.toPlay.map((g) => g.comment_id)).toEqual(["c"]);
  });
  it("既読は 1 回目でも 2 回目でも除外される", () => {
    expect(partitionFreshGifts([gift("a")], new Set(["a"]), true).fresh).toEqual([]);
    expect(partitionFreshGifts([gift("a")], new Set(["a"]), false).toPlay).toEqual([]);
  });
  it("再接続直後（1 回目扱い）は過去分が鳴らない", () => {
    // 再接続では last_updated_at が 0 に戻り、過去のギフトがまとめて返ってくる
    const r = partitionFreshGifts([gift("old1"), gift("old2")], new Set(), true);
    expect(r.fresh).toHaveLength(2);
    expect(r.toPlay).toEqual([]);
  });
  it("空の応答では何も起きない", () => {
    expect(partitionFreshGifts([], new Set(), false)).toEqual({ fresh: [], toPlay: [] });
  });
});
