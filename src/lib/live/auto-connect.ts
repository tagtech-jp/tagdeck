// 自動接続（改善A）の待機ポーリングと状態遷移（純関数。画面から切り離してテストする）。
//
// 「配信開始時に自動接続」が ON の間は、非配信中も待機ポーリングを回して配信開始を検知する。
// ただし配信予定が無いまま何時間も 30 秒間隔で叩き続けるのは無駄なので、待ち時間に応じて間隔を伸ばす。

/** 待機ポーリングの間隔。調整はここ 1 箇所で行う */
export const IDLE_POLL_INTERVAL_MS = {
  base: 30_000,
  after30min: 60_000,
  after2h: 300_000,
} as const;

/** 間隔を伸ばす境目。待機開始からの経過時間 */
export const IDLE_ESCALATE_AFTER_MS = {
  toMinute: 30 * 60_000,
  toFiveMinutes: 2 * 60 * 60_000,
} as const;

/** 待機開始からの経過時間で間隔を決める。配信を検知したら待機開始時刻がリセットされるので base に戻る */
export function idlePollInterval(waitedMs: number): number {
  if (waitedMs > IDLE_ESCALATE_AFTER_MS.toFiveMinutes) return IDLE_POLL_INTERVAL_MS.after2h;
  if (waitedMs > IDLE_ESCALATE_AFTER_MS.toMinute) return IDLE_POLL_INTERVAL_MS.after30min;
  return IDLE_POLL_INTERVAL_MS.base;
}

/**
 * off       … 自動接続 OFF
 * waiting   … 待機ポーリング中（非配信）
 * connecting… 配信を検知して接続処理中
 * connected … 接続済み（ギフト取得中）
 */
export type AutoConnectPhase = "off" | "waiting" | "connecting" | "connected";

export interface AutoConnectState {
  phase: AutoConnectPhase;
  /** 待機を開始した時刻。間隔の段階判定に使う。待機中以外は null */
  waitingStartedAt: number | null;
}

export type AutoConnectEvent =
  | { type: "enable"; now: number }
  | { type: "disable" }
  | { type: "live_detected" }
  | { type: "connected" }
  /** 配信終了・手動停止・接続失敗。自動接続が ON の間は待機へ戻る */
  | { type: "disconnected"; now: number };

export const INITIAL_AUTO_CONNECT_STATE: AutoConnectState = { phase: "off", waitingStartedAt: null };

/** 待機 → 配信検知 → 接続 → 配信終了 → 待機 の遷移 */
export function reduceAutoConnect(state: AutoConnectState, event: AutoConnectEvent): AutoConnectState {
  switch (event.type) {
    case "enable":
      return { phase: "waiting", waitingStartedAt: event.now };
    case "disable":
      return INITIAL_AUTO_CONNECT_STATE;
    case "live_detected":
      return state.phase === "waiting" ? { phase: "connecting", waitingStartedAt: null } : state;
    case "connected":
      // 手動接続（自動接続 OFF）のときは off のまま。自動接続 ON のときだけ connected へ進む
      return state.phase === "connecting" || state.phase === "waiting" ? { phase: "connected", waitingStartedAt: null } : state;
    case "disconnected":
      // OFF のときは待機に戻さない（手動で止めたらそのまま止まる）
      return state.phase === "off" ? state : { phase: "waiting", waitingStartedAt: event.now };
    default:
      return state;
  }
}
