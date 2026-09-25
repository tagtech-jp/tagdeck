import { normalizeWhowatchUserPath } from "./live-feed";

/**
 * 配信者ID欄に「自分のID」を入れた場合も自分の配信として扱うための判定。
 *
 * 他人扱いになると記録が dryRun になり、ポーリングも 10 秒固定に落ちるため、
 * 自分のIDを手入力しただけで機能が縮退してしまう。
 *
 * ふわっちのIDは大文字小文字を区別する（`w:Thomas19981022` が実在する）ため、
 * 突き合わせは完全一致で行う。曖昧一致にすると別人を自分と誤認し、
 * 他人の配信のデータを自分の記録として書き込む危険がある。
 */
export function isSameWhowatchUser(ownId: string | null | undefined, resolvedUserPath: string | null | undefined): boolean {
  if (!ownId || !resolvedUserPath) return false;
  return normalizeWhowatchUserPath(ownId).candidates.includes(resolvedUserPath);
}
