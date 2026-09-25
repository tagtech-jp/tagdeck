// 実験（2026-09-25）: スマホでもバックグラウンドで SE を鳴らすための「音楽プレイヤー扱い」。
//
// 仕組み:
//   1) <audio> 要素で無音に近い音（25 Hz・振幅 0.4%：スマホのスピーカーでは再生できない帯域）をループ再生する。
//      OS はこれを「音楽再生中」と見なし、他のアプリへ切り替えたり画面を消したりしてもページを止めにくくなる
//   2) Media Session で通知バー / ロック画面に再生カードを出す（Android はこれで「再生中のメディア」として扱う）
//   3) iOS 17+ は navigator.audioSession.type = "playback" でサイレントスイッチ・画面ロックでも音声を継続させる
//   4) Wake Lock（画面ロック防止）は別スイッチで併用できる（画面が点いている限り確実に鳴る）
//
// 既存の keep-alive（engine.ts の startKeepAlive: Web Audio の無音ループ）は PC 向けで、スマホの OS は
// Web Audio 単体を「音楽再生中」と見なさない。こちらは <audio> 要素なので扱いが変わる。
// iOS で画面ロック後も JavaScript（ギフト取得）が動き続けるかは OS 次第のため、結果は実機で確認する。

export interface BgAudioSupport {
  audioElement: boolean;
  mediaSession: boolean;
  wakeLock: boolean;
  /** iOS 17+ Safari の navigator.audioSession */
  audioSession: boolean;
}

export type BgAudioState = "off" | "starting" | "playing" | "paused" | "error";

/** 無音に近い WAV（16bit モノラル）を data URL で作る。ファイルを置かずに済ませるため */
export function makeNearSilentWavDataUrl(opts: { seconds?: number; sampleRate?: number; amplitude?: number; freqHz?: number } = {}): string {
  const seconds = opts.seconds ?? 20;
  const sampleRate = opts.sampleRate ?? 8000;
  const amplitude = opts.amplitude ?? 0.004;
  const freqHz = opts.freqHz ?? 25;
  const n = Math.floor(seconds * sampleRate);
  const dataBytes = n * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  const peak = Math.round(32767 * amplitude);
  for (let i = 0; i < n; i++) {
    const s = Math.round(Math.sin((i / sampleRate) * 2 * Math.PI * freqHz) * peak);
    v.setInt16(44 + i * 2, s, true);
  }
  return `data:audio/wav;base64,${bytesToBase64(new Uint8Array(buf))}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}

export function detectBgAudioSupport(nav: Navigator | undefined = typeof navigator !== "undefined" ? navigator : undefined): BgAudioSupport {
  const n = nav as (Navigator & { audioSession?: unknown; wakeLock?: unknown; mediaSession?: unknown }) | undefined;
  return {
    audioElement: typeof Audio !== "undefined",
    mediaSession: Boolean(n && "mediaSession" in n && n.mediaSession),
    wakeLock: Boolean(n && "wakeLock" in n && n.wakeLock),
    audioSession: Boolean(n && "audioSession" in n && n.audioSession),
  };
}

export interface BackgroundKeepAliveOptions {
  onStateChange?: (state: BgAudioState, error: string | null) => void;
  /** 再生カードの「一時停止」「停止」をユーザーが押した（OS の割り込みではない） */
  onUserPause?: () => void;
  metadata?: { title: string; artist: string; artwork?: Array<{ src: string; sizes: string; type: string }> };
}

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void };

export class BackgroundKeepAlive {
  private audio: HTMLAudioElement | null = null;
  private wakeLock: WakeLockSentinelLike | null = null;
  private wantWakeLock = false;
  private state: BgAudioState = "off";
  private error: string | null = null;
  private readonly onVisibility = () => void this.handleVisibility();

  constructor(private readonly opts: BackgroundKeepAliveOptions = {}) {}

  getState(): BgAudioState {
    return this.state;
  }

  private setState(s: BgAudioState, error: string | null = null) {
    this.state = s;
    this.error = error;
    this.opts.onStateChange?.(s, error);
  }

  /** 初回はユーザー操作（クリック）の中で呼ぶこと（自動再生制限） */
  async start(): Promise<boolean> {
    if (typeof window === "undefined" || typeof Audio === "undefined") {
      this.setState("error", "この環境では使えません");
      return false;
    }
    this.setState("starting");
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) {
        try {
          nav.audioSession.type = "playback";
        } catch {
          // 設定できなくても再生は試す
        }
      }
      if (!this.audio) {
        const a = new Audio(makeNearSilentWavDataUrl());
        a.loop = true;
        a.preload = "auto";
        a.setAttribute("playsinline", "");
        a.addEventListener("pause", () => {
          // OS の割り込み（電話・他アプリの音声）で止まったら記録し、画面に戻ったときに再開を試す
          if (this.state === "playing") this.setState("paused", "OS に一時停止されました（画面に戻ると再開を試みます）");
        });
        a.addEventListener("playing", () => {
          if (this.state !== "off") this.setState("playing");
        });
        this.audio = a;
      }
      await this.audio.play();
      this.installMediaSession();
      document.addEventListener("visibilitychange", this.onVisibility);
      this.setState("playing");
      if (this.wantWakeLock) await this.acquireWakeLock();
      return true;
    } catch (e) {
      this.setState("error", e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  stop(): void {
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.clearMediaSession();
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    void this.releaseWakeLock();
    this.setState("off");
  }

  /** 画面ロック防止の ON/OFF（再生中なら即時に反映） */
  async setWakeLock(enabled: boolean): Promise<void> {
    this.wantWakeLock = enabled;
    if (enabled && this.state === "playing") await this.acquireWakeLock();
    if (!enabled) await this.releaseWakeLock();
  }

  hasWakeLock(): boolean {
    return this.wakeLock !== null;
  }

  private async handleVisibility() {
    if (document.visibilityState !== "visible") return;
    // 画面に戻ったら、OS に止められていた再生と Wake Lock を取り直す
    if (this.audio && this.state === "paused") {
      try {
        await this.audio.play();
        this.setState("playing");
      } catch (e) {
        this.setState("paused", e instanceof Error ? e.message : String(e));
      }
    }
    if (this.wantWakeLock && this.state === "playing") await this.acquireWakeLock();
  }

  private installMediaSession() {
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (!ms) return;
    try {
      const meta = this.opts.metadata ?? { title: "TagDeck ライブ SE 待機中", artist: "TagDeck" };
      ms.metadata = new MediaMetadata({ title: meta.title, artist: meta.artist, artwork: meta.artwork ?? [] });
      ms.playbackState = "playing";
      ms.setActionHandler("play", () => {
        void this.audio?.play();
        ms.playbackState = "playing";
      });
      ms.setActionHandler("pause", () => {
        ms.playbackState = "paused";
        this.opts.onUserPause?.();
      });
      ms.setActionHandler("stop", () => {
        ms.playbackState = "none";
        this.opts.onUserPause?.();
      });
    } catch {
      // Media Session が使えなくても音声の継続だけは試す
    }
  }

  private clearMediaSession() {
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (!ms) return;
    try {
      ms.playbackState = "none";
      ms.metadata = null;
      for (const a of ["play", "pause", "stop"] as const) ms.setActionHandler(a, null);
    } catch {
      // 無視
    }
  }

  private async acquireWakeLock() {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wl || this.wakeLock || document.visibilityState !== "visible") return;
    try {
      const s = await wl.request("screen");
      s.addEventListener?.("release", () => {
        this.wakeLock = null;
      });
      this.wakeLock = s;
    } catch {
      this.wakeLock = null;
    }
  }

  private async releaseWakeLock() {
    const s = this.wakeLock;
    this.wakeLock = null;
    if (s) {
      try {
        await s.release();
      } catch {
        // 既に解放済み
      }
    }
  }
}
