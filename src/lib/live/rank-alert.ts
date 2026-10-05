// /live の順位パネルと追い上げアラート（2026-10-05 社長指示「追い上げアラート：警告＋効果音」）。
//
// ranking_snapshots の直近 2 枚から、自分の順位・上下との差・目標順位までの差と、警告を作る（純関数）。
// - 追い上げ: すぐ下の人が前回より差を詰めていて、そのペースだと CHASE_ETA_MINUTES 分以内に抜かれる
// - 抜かれた: 前回より順位が下がった
// - 目標割れ: 前回は目標順位以内だったのに、今回は外れた
// 同じ人の判定は rank-forecast の rivalKey と同じ（user_id → user_path → name）。
// ランキングの同期は 5 分ごと（src/worker.ts の Cron）なので、2 枚の間隔は通常 5 分。

export interface RankEntryLite {
  rank: number;
  point: number;
  user_id: string | null;
  user_path: string | null;
  name: string;
}

export interface RankSnapshotLite {
  capturedAt: Date;
  myRank: number | null;
  myPoint: number | null;
  entries: readonly RankEntryLite[];
}

/** このペースで何分以内に抜かれそうなら「追い上げ」とするか */
export const CHASE_ETA_MINUTES = 30;
/** 2 枚の間隔がこれより長い（同期が止まっていた等）なら、追い上げのペースは計算しない */
export const MAX_SNAPSHOT_GAP_MINUTES = 20;

export type RankAlertKind = "chase" | "overtaken" | "target_lost";

export interface RankAlert {
  kind: RankAlertKind;
  message: string;
}

export interface RankStatus {
  capturedAt: string;
  myRank: number;
  myPoint: number;
  /** すぐ上の人との差（pt）。1 位なら null */
  above: { name: string; gap: number } | null;
  /** すぐ下の人との差（pt）と、前回からの詰め方（pt/時・正なら詰められている）。最下位なら null */
  below: { name: string; gap: number; closingPerHour: number | null; etaMinutes: number | null } | null;
  /** 目標順位。gap > 0 は目標の順位の人まで足りない pt、gap <= 0 は目標圏内（-gap が 1 つ下との余裕） */
  target: { rank: number; gap: number } | null;
  alerts: RankAlert[];
}

function personKey(e: Pick<RankEntryLite, "user_id" | "user_path" | "name">): string {
  return e.user_id ?? e.user_path ?? e.name;
}

function entryAt(entries: readonly RankEntryLite[], rank: number): RankEntryLite | null {
  return entries.find((e) => e.rank === rank) ?? null;
}

const pt = (n: number) => `${n.toLocaleString("ja-JP")}pt`;

export function computeRankStatus(latest: RankSnapshotLite, prev: RankSnapshotLite | null, targetRank: number | null): RankStatus | null {
  if (latest.myRank === null || latest.myPoint === null) return null;
  const myRank = latest.myRank;
  const myPoint = latest.myPoint;
  const alerts: RankAlert[] = [];

  const aboveEntry = myRank > 1 ? entryAt(latest.entries, myRank - 1) : null;
  const above = aboveEntry ? { name: aboveEntry.name, gap: aboveEntry.point - myPoint } : null;

  const belowEntry = entryAt(latest.entries, myRank + 1);
  let below: RankStatus["below"] = null;
  if (belowEntry) {
    const gap = myPoint - belowEntry.point;
    let closingPerHour: number | null = null;
    let etaMinutes: number | null = null;
    const minutes = prev ? (latest.capturedAt.getTime() - prev.capturedAt.getTime()) / 60_000 : 0;
    const prevBelow = prev?.entries.find((e) => personKey(e) === personKey(belowEntry));
    if (prev && prev.myPoint !== null && prevBelow && minutes > 0 && minutes <= MAX_SNAPSHOT_GAP_MINUTES) {
      const closing = prev.myPoint - prevBelow.point - gap;
      closingPerHour = Math.round((closing / minutes) * 60);
      if (closing > 0) {
        etaMinutes = Math.max(0, Math.round(gap / (closing / minutes)));
        if (etaMinutes <= CHASE_ETA_MINUTES) {
          alerts.push({ kind: "chase", message: `${belowEntry.name}さんが追い上げ中：差 ${pt(gap)}（このペースだと約 ${etaMinutes} 分で抜かれます）` });
        }
      }
    }
    below = { name: belowEntry.name, gap, closingPerHour, etaMinutes };
  }

  if (prev?.myRank != null && myRank > prev.myRank) {
    alerts.push({ kind: "overtaken", message: `順位が ${prev.myRank} 位 → ${myRank} 位に下がりました` });
  }

  let target: RankStatus["target"] = null;
  if (targetRank !== null && targetRank > 0) {
    // 圏内なら 1 つ外の人との差（負＝余裕）、圏外なら目標の順位の人までの差
    const ref = entryAt(latest.entries, myRank <= targetRank ? targetRank + 1 : targetRank);
    target = { rank: targetRank, gap: ref ? ref.point - myPoint : 0 };
    if (prev?.myRank != null && prev.myRank <= targetRank && myRank > targetRank) {
      alerts.push({ kind: "target_lost", message: `目標の ${targetRank} 位から外れました（あと ${pt(Math.max(0, target.gap))}）` });
    }
  }

  return { capturedAt: latest.capturedAt.toISOString(), myRank, myPoint, above, below, target, alerts };
}
