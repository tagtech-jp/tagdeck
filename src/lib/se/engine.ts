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
/** 取得・デコード中の Promise。同じ URL が同時に来ても 1 回にまとめる */
const inflight = new Map<string, Promise<AudioBuffer | null>>();

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

/** 合成音のおおよその長さ（秒）。連続再生で次の音を待つ目安 */
const SYNTH_DURATION_S: Record<SeTier, number> = { T0: 0.15, T1: 0.45, T2: 0.85, T3: 1.35, T4: 2.4, hit: 1.6 };

/**
 * カスタム音源（URL）を取得してデコードし、キャッシュに入れる。失敗時は null（呼び出し側は合成音に落とす）。
 * 同じ URL の取得が重なっても 1 回にまとめる
 */
async function loadBuffer(c: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(url);
  if (cached) return cached;
  const running = inflight.get(url);
  if (running) return running;
  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = await c.decodeAudioData(await res.arrayBuffer());
      bufferCache.set(url, buf);
      return buf;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

/**
 * 設定済みのカスタム音源を先に取得・デコードしておく（接続時・設定変更時に呼ぶ）。
 * 2026-09-25 計測: SE キュー待ちは 1ms まで詰まったが、アップロード音源は「その種類が初めて鳴る瞬間」に
 * 取得＋デコードが走り、初回だけ数百 ms 余分にかかっていた。先読みしておけば初回も即時に鳴る。
 * 取れなかった URL は無視する（鳴らす時点で改めて試み、だめなら合成音に落ちる）
 */
export async function preloadSe(urls: Array<string | null | undefined>): Promise<void> {
  const c = getAudioContext();
  if (!c) return;
  const unique = [...new Set(urls.filter((u): u is string => typeof u === "string" && u !== ""))];
  await Promise.all(unique.map((u) => loadBuffer(c, u)));
}

/**
 * カスタム音源（URL）を再生。取得失敗時は null、成功時は「鳴り終わるまで」の Promise を返す
 * （連続ギフトで前の音が終わってから次を鳴らすため。2026-09-25: 200ms ずらしで重ねると
 *  長めの音源では 2 発目以降が 1 発目に埋もれて「連続で鳴らない」ように聞こえた）
 */
export async function playUrl(url: string, volume = 0.8): Promise<{ ended: Promise<void> } | null> {
  const c = getAudioContext();
  if (!c) return null;
  try {
    const buf = await loadBuffer(c, url);
    if (!buf) return null;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = Math.max(0, Math.min(1, volume));
    src.connect(g).connect(c.destination);
    const ended = new Promise<void>((resolve) => {
      src.onended = () => resolve();
      // onended が来ない環境の保険（長さ + 少し）
      setTimeout(resolve, Math.ceil((buf.duration + 0.1) * 1000));
    });
    src.start();
    // await で入れ子の Promise が潰れないようオブジェクトで包む
    return { ended };
  } catch {
    return null;
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

/**
 * ギフト 1 件を鳴らす: カスタム URL があればそれ、無ければティア合成。
 * 戻り値は「鳴り始めた」時点で解決する（試聴ボタン等はこれで十分）。
 * 鳴り終わりまで待ちたい場合は playSeUntilEnd を使う
 */
export async function playSe(tier: SeTier, opts: SePlayOptions = {}): Promise<void> {
  await playSeUntilEnd(tier, opts, false);
}

/**
 * ギフト 1 件を鳴らし、waitForEnd=true なら鳴り終わるまで待つ（連続ギフトのキューが順番に鳴らすため）。
 * 合成音は目安の長さ、カスタム音源は実際の長さで待つ
 */
export async function playSeUntilEnd(tier: SeTier, opts: SePlayOptions = {}, waitForEnd = true): Promise<void> {
  const vol = opts.volume ?? 0.8;
  let ended: Promise<void> | null = null;
  if (opts.url) ended = (await playUrl(opts.url, vol))?.ended ?? null;
  if (!ended) {
    synthTier(tier, vol);
    ended = new Promise<void>((r) => setTimeout(r, Math.ceil(SYNTH_DURATION_S[tier] * 1000)));
  }
  if (waitForEnd) await ended;
}
