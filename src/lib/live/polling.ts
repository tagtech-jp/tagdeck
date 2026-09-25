// ライブコックピットのポーリング制御（純関数。画面から切り離してテストする）

/**
 * ポーリング間隔。調整はここ 1 箇所で行う。
 * 対策F: 盛り上がっている間だけ短くする。単純に全部短くするとふわっちへの負荷が 3〜5 倍になるため、
 * 直近にギフトがあったときだけ短い間隔、静かなときはふわっちのサーバ指定どおり 10 秒に戻す。
 * 他人の配信を見ているときは常に 10 秒（自分の配信ではないので短くする理由が無い）。
 *
 * active は 2026-09-23 に 3 秒 → 1.5 秒へ変更（平均待ちが 1.5 秒 → 0.75 秒になる）。
 * 投げ銭が続いている間だけなので、静かな時間を含めた平均負荷はふわっちの指定値に近いまま保たれる。
 */
export const POLL_INTERVAL_MS = { active: 1_500, idle: 10_000, other: 10_000 } as const;

/** 「盛り上がっている」と見なす時間。最後のギフトからこの時間内なら active 間隔を使う */
export const ACTIVE_WINDOW_MS = 60_000;

/** 応答が遅れても最低これだけは間を空ける */
export const MIN_POLL_DELAY_MS = 1_000;

export interface PollIntervalInput {
  /** 他人の配信を見ているか（見ているなら常に idle 間隔） */
  isOther: boolean;
  /** ふわっちのサーバ指定間隔（実測 10000ms 固定） */
  serverIntervalMs: number;
  /** 最後にギフトを検知した時刻。まだ無ければ null */
  lastGiftAt: number | null;
  now: number;
}

/**
 * 次のポーリング間隔を決める。
 * - 他人の配信: 常に idle（10 秒）
 * - 直近 ACTIVE_WINDOW_MS 以内にギフトがあった: active（3 秒）
 * - それ以外: idle（10 秒）
 * - ふわっちが idle より長い間隔を指示してきた場合は、負荷対策の指示としてそちらに従う（既存の挙動）
 */
export function pollIntervalFor(input: PollIntervalInput): number {
  const { isOther, serverIntervalMs, lastGiftAt, now } = input;
  if (serverIntervalMs > POLL_INTERVAL_MS.idle) return serverIntervalMs;
  if (isOther) return POLL_INTERVAL_MS.other;
  const isActive = lastGiftAt !== null && now - lastGiftAt <= ACTIVE_WINDOW_MS;
  return isActive ? POLL_INTERVAL_MS.active : POLL_INTERVAL_MS.idle;
}

/**
 * 固定レートで次回を予約するための待ち時間。
 * 「取得完了から interval」ではなく「取得開始から interval」にすることで、往復時間の分だけ周期が伸びるのを防ぐ。
 */
export function nextPollDelay(intervalMs: number, elapsedMs: number): number {
  return Math.max(MIN_POLL_DELAY_MS, intervalMs - elapsedMs);
}

/**
 * 未受信のギフトを選ぶ。接続直後の 1 回目は過去のコメントがまとめて返るため、
 * 画面には出すが SE は鳴らさない（接続前に投げられた分が一斉に鳴るのを防ぐ）。
 */
export function partitionFreshGifts<T extends { comment_id: string }>(
  gifts: T[],
  seen: ReadonlySet<string>,
  isFirstPoll: boolean,
): { fresh: T[]; toPlay: T[] } {
  const fresh = gifts.filter((g) => !seen.has(g.comment_id));
  return { fresh, toPlay: isFirstPoll ? [] : fresh };
}
