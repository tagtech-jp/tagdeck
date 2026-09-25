"use client";

// S1: SE エンジン（ブラウザ専用・Web Audio）。既定パックは合成音で権利問題なし。
//   T0 無料 = 短いポップ / T1〜T4 = 金額帯ごとに音の厚み・長さ・音量を段階化 / hit = ジングル
//   ユーザーがアップロードした音源（URL）があればそれを再生する。

import type { SeTier } from "./tiers";

export interface SePlayOptions {
  /** 0〜1 */
  volume?: number;
  /** カスタム音源 URL（mp3/ogg/wav）。無ければ合成 */
  url?: string | null;
}

let ctx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();

export function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** ユーザー操作（クリック）内で呼んで自動再生制限を解除する */
export async function unlockAudio(): Promise<boolean> {
  const c = getAudioContext();
  if (!c) return false;
  if (c.state === "suspended") await c.resume();
  return c.state === "running";
}

function tone(c: AudioContext, dest: AudioNode, freq: number, start: number, dur: number, gain: number, type: OscillatorType = "sine"): void {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(dest);
  o.start(start);
  o.stop(start + dur + 0.05);
}

function noise(c: AudioContext, dest: AudioNode, start: number, dur: number, gain: number): void {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(g).connect(dest);
  src.start(start);
}

/** ティア別の合成音。金額帯で音量・長さ・和音の厚みを段階化 */
export function synthTier(tier: SeTier, volume = 0.8): void {
  const c = getAudioContext();
  if (!c) return;
  const master = c.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume));
  master.connect(c.destination);
  const t = c.currentTime;
  switch (tier) {
    case "T0": // 無料: 短いポップ
      tone(c, master, 880, t, 0.08, 0.5, "triangle");
      break;
    case "T1": // チャイム・短
      tone(c, master, 1046.5, t, 0.25, 0.4);
      tone(c, master, 1318.5, t + 0.12, 0.3, 0.35);
      break;
    case "T2": // チャイム（3 音）
      tone(c, master, 1046.5, t, 0.3, 0.45);
      tone(c, master, 1318.5, t + 0.15, 0.3, 0.45);
      tone(c, master, 1568, t + 0.3, 0.5, 0.5);
      break;
    case "T3": // ファンファーレ・短（和音）
      for (const [f, d] of [[523.25, 0], [659.25, 0], [783.99, 0], [1046.5, 0.25]] as const) tone(c, master, f, t + d, 0.6, 0.35, "square");
      tone(c, master, 1318.5, t + 0.5, 0.8, 0.4, "square");
      break;
    case "T4": // ファンファーレ（長・厚い）
      for (const [f, d] of [[392, 0], [523.25, 0], [659.25, 0], [783.99, 0.2], [1046.5, 0.4]] as const) tone(c, master, f, t + d, 1.0, 0.35, "sawtooth");
      for (const [f, d] of [[1318.5, 0.7], [1568, 0.9], [2093, 1.1]] as const) tone(c, master, f, t + d, 1.2, 0.4, "square");
      noise(c, master, t + 1.1, 0.6, 0.15);
      break;
    case "hit": // 当たり: ジングル（上昇アルペジオ + キラキラ）
      for (const [f, d] of [[659.25, 0], [830.6, 0.09], [987.77, 0.18], [1318.5, 0.27], [1661.2, 0.36], [1975.5, 0.45]] as const) tone(c, master, f, t + d, 0.5, 0.4, "triangle");
      tone(c, master, 2637, t + 0.6, 0.9, 0.3);
      noise(c, master, t + 0.55, 0.4, 0.1);
      break;
  }
}

/** カスタム音源（URL）を再生。取得失敗時は false */
export async function playUrl(url: string, volume = 0.8): Promise<boolean> {
  const c = getAudioContext();
  if (!c) return false;
  try {
    let buf = bufferCache.get(url);
    if (!buf) {
      const res = await fetch(url);
      if (!res.ok) return false;
      buf = await c.decodeAudioData(await res.arrayBuffer());
      bufferCache.set(url, buf);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(g).connect(c.destination);
    src.start();
    return true;
  } catch {
    return false;
  }
}

let keepAlive: AudioBufferSourceNode | null = null;

/**
 * 聞こえない極小音を鳴らし続けてタブを「音声再生中」にする。
 * ブラウザは非表示タブのタイマーを間引くが、音声を出しているタブは対象外になるため、
 * OBS を前面にしていてもポーリングが止まらない。
 * 振幅 0.001（約 -60dBFS）: ブラウザは一定以下の音量を無音とみなすので 0 にはできない。
 * 配信に乗らないことは README の手順で確認する。
 */
export function startKeepAlive(): void {
  const c = getAudioContext();
  if (!c || keepAlive) return;
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.sin((i / c.sampleRate) * 2 * Math.PI * 40) * 0.001;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(c.destination);
  src.start();
  keepAlive = src;
}

export function stopKeepAlive(): void {
  keepAlive?.stop();
  keepAlive = null;
}

/** ギフト 1 件を鳴らす: カスタム URL があればそれ、無ければティア合成 */
export async function playSe(tier: SeTier, opts: SePlayOptions = {}): Promise<void> {
  const vol = opts.volume ?? 0.8;
  if (opts.url) {
    const ok = await playUrl(opts.url, vol);
    if (!ok) synthTier(tier, vol);
  } else {
    synthTier(tier, vol);
  }
}
