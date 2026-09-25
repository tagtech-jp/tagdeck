import { describe, expect, it } from "vitest";
import { detectBgAudioSupport, makeNearSilentWavDataUrl } from "./background-keepalive";

describe("makeNearSilentWavDataUrl", () => {
  it("正しい WAV ヘッダと長さを持つ data URL を作る", () => {
    const url = makeNearSilentWavDataUrl({ seconds: 1, sampleRate: 8000, amplitude: 0.004, freqHz: 25 });
    expect(url.startsWith("data:audio/wav;base64,")).toBe(true);
    const bytes = Buffer.from(url.slice("data:audio/wav;base64,".length), "base64");
    expect(bytes.length).toBe(44 + 8000 * 2);
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
    expect(bytes.readUInt32LE(24)).toBe(8000); // sampleRate
    expect(bytes.readUInt16LE(22)).toBe(1); // mono
    expect(bytes.readUInt32LE(40)).toBe(8000 * 2); // data size
  });
  it("振幅は指定値を超えない（無音に近い）", () => {
    const url = makeNearSilentWavDataUrl({ seconds: 0.5, sampleRate: 8000, amplitude: 0.004 });
    const bytes = Buffer.from(url.slice("data:audio/wav;base64,".length), "base64");
    let peak = 0;
    for (let i = 44; i < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
    expect(peak).toBeLessThanOrEqual(Math.round(32767 * 0.004));
    expect(peak).toBeGreaterThan(0); // 完全な無音ではない（無音だと「再生中」扱いされない OS がある）
  });
});

describe("detectBgAudioSupport", () => {
  it("navigator の機能有無を返す", () => {
    const fake = { mediaSession: {}, wakeLock: {} } as unknown as Navigator;
    const s = detectBgAudioSupport(fake);
    expect(s.mediaSession).toBe(true);
    expect(s.wakeLock).toBe(true);
    expect(s.audioSession).toBe(false);
  });
  it("navigator が無ければ全部 false（Audio も無い Node）", () => {
    const s = detectBgAudioSupport(undefined);
    expect(s).toEqual({ audioElement: false, mediaSession: false, wakeLock: false, audioSession: false });
  });
});
