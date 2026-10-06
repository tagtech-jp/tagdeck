import { describe, expect, it } from "vitest";
import { createMasterOutput, MASTER_BOOST, resumeWithTimeout, scheduleCut, SE_FADE_OUT_S } from "./engine";

describe("resumeWithTimeout（無音後の復帰）", () => {
  it("running ならそのまま true", async () => {
    expect(await resumeWithTimeout({ state: "running", resume: async () => undefined }, 100)).toBe(true);
  });
  it("suspended → resume() で running になれば true", async () => {
    const c = { state: "suspended", resume: async () => { c.state = "running"; } };
    expect(await resumeWithTimeout(c, 100)).toBe(true);
  });
  it("resume() が永久に pending でも timeout で抜けて false", async () => {
    const c = { state: "suspended", resume: () => new Promise<void>(() => {}) };
    const t0 = Date.now();
    expect(await resumeWithTimeout(c, 50)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("resume() が reject しても例外にせず false", async () => {
    const c = { state: "interrupted", resume: async () => { throw new Error("NotAllowed"); } };
    expect(await resumeWithTimeout(c, 100)).toBe(false);
  });
  it("closed は再開できないので false（呼び出し側で作り直す）", async () => {
    expect(await resumeWithTimeout({ state: "closed", resume: async () => undefined }, 100)).toBe(false);
  });
});

describe("全体の音量（2026-09-30 社長指示「音を全体的に3倍に」）", () => {
  type FakeNode = { name: string; to: FakeNode[]; connect: (n: FakeNode) => FakeNode };
  const node = (name: string, extra: Record<string, unknown> = {}): FakeNode & Record<string, unknown> => {
    const n: FakeNode & Record<string, unknown> = { name, to: [], connect: (m: FakeNode) => (n.to.push(m), m), ...extra };
    return n;
  };
  const param = () => ({ value: 0 });

  it("増幅 3 倍 → リミッター → スピーカー の順につなぐ", () => {
    const destination = node("destination");
    const c = {
      destination,
      createGain: () => node("gain", { gain: param() }),
      createDynamicsCompressor: () => node("limiter", { threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    };
    const out = createMasterOutput(c as never) as unknown as FakeNode & { gain: { value: number } };
    expect(MASTER_BOOST).toBe(3);
    expect(out.gain.value).toBe(3);
    const limiter = out.to[0] as FakeNode & { threshold: { value: number }; ratio: { value: number } };
    expect(limiter.name).toBe("limiter");
    expect(limiter.threshold.value).toBe(-3);
    expect(limiter.ratio.value).toBe(20);
    expect(limiter.to[0]).toBe(destination);
  });

  it("リミッターが無い環境では増幅だけでスピーカーへ", () => {
    const destination = node("destination");
    const out = createMasterOutput({ destination, createGain: () => node("gain", { gain: param() }) } as never) as unknown as FakeNode;
    expect(out.to[0]).toBe(destination);
  });
});

describe("scheduleCut（待ち行列が詰まったら長い音を短く切る）", () => {
  const fakes = () => {
    const calls: string[] = [];
    const src = { stop: (t?: number) => void calls.push(`stop@${t}`) };
    const gain = {
      setValueAtTime: (v: number, t: number) => (calls.push(`set ${v}@${t}`), gain),
      linearRampToValueAtTime: (v: number, t: number) => (calls.push(`ramp ${v}@${t}`), gain),
    };
    return { calls, src, gain };
  };

  it("音源が上限より長ければ、上限の手前からフェードアウトして止める", () => {
    const { calls, src, gain } = fakes();
    expect(scheduleCut(src as never, gain as never, 10, 0.8, 9.5, 2)).toBe(2);
    expect(calls).toEqual([`set 0.8@${10 + 2 - SE_FADE_OUT_S}`, "ramp 0@12", "stop@12.02"]);
  });

  it("上限なし・上限より短い音源は何もしない", () => {
    const { calls, src, gain } = fakes();
    expect(scheduleCut(src as never, gain as never, 0, 0.8, 9.5, null)).toBe(9.5);
    expect(scheduleCut(src as never, gain as never, 0, 0.8, 1.5, 2)).toBe(1.5);
    expect(calls).toEqual([]);
  });
});
