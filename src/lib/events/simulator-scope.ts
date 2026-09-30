// イベントシミュレーター（event_simulators）の「本人の・削除済みでない 1 件」を指す条件。
//
// 削除は論理削除（status = "deleted"）にしている。行を消すと ranking_snapshots が
// 外部キーの ON DELETE CASCADE（drizzle/0011）で一緒に消え、E3 の実データ検証に使う
// ランキング履歴が失われるため（実害: 2026-09-30 に、削除済みの秋コレのシミュレーターの履歴が 0 件になっているのを確認）。
// id を指定して読み書きする API はすべてこの条件で絞り、削除済みは「存在しない」扱い（404）にする。
// 一覧・Cron・poll は従来どおり status = "active" で絞るので、削除済みは自然に外れる。

import { and, eq, ne, type SQL } from "drizzle-orm";
import { eventSimulators } from "@/lib/db/schema";

/** 論理削除したシミュレーターの status */
export const SIMULATOR_DELETED_STATUS = "deleted";

/** id が一致し、本人のもので、削除済みでないシミュレーターを指す WHERE 条件 */
export function ownedSimulator(id: string, userId: string): SQL {
  return and(
    eq(eventSimulators.id, id),
    eq(eventSimulators.userId, userId),
    ne(eventSimulators.status, SIMULATOR_DELETED_STATUS),
  ) as SQL;
}
