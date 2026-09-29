// ライブ画面の「配信者ID」欄の既定（2026-09-30 社長指示「プラットフォームの連携をした ID をすべてデフォルトで固定」）。
//
// 既定は「固定 ON」で、欄には設定（プラットフォーム連携）のふわっち ID を入れる。
//   - 固定のチェックを自分で外したときだけ、次回も外したまま（TARGET_PIN_STORAGE_KEY = "0"）
//   - 欄の値が連携 ID から自動で入ったもの（source = "linked"）なら、設定の ID を変えたときに追従する
//   - 自分で打った ID（source = "typed"）は固定中そのまま残す
// Kick / ニコ生はライブ画面に ID 欄が無く、設定の ID をそのまま使う（ここでは扱わない）。

import { normalizeWhowatchUserPath } from "@/lib/whowatch/user-path";

export const TARGET_ID_STORAGE_KEY = "tagdeck.live.targetId";
/** "1" = 固定 / "0" = 自分で固定を外した。無ければ既定（固定） */
export const TARGET_PIN_STORAGE_KEY = "tagdeck.live.targetIdPin";
/** 欄の値の出どころ。"linked" = 連携 ID から自動 / "typed" = 自分で入力 */
export const TARGET_SOURCE_STORAGE_KEY = "tagdeck.live.targetIdSource";

export type TargetSource = "linked" | "typed";

export interface InitialTargetInput {
  savedId: string | null;
  pinChoice: string | null;
  source: string | null;
  linkedId: string | null;
}

export interface InitialTarget {
  targetId: string;
  pinned: boolean;
  source: TargetSource;
}

/** 保存値と連携 ID から、欄の初期値と固定状態を決める */
export function resolveInitialTarget(i: InitialTargetInput): InitialTarget {
  const pinned = i.pinChoice !== "0";
  const source: TargetSource = i.source === "typed" ? "typed" : "linked";
  const saved = (i.savedId ?? "").trim();
  const linked = (i.linkedId ?? "").trim();
  if (!pinned) return { targetId: "", pinned: false, source: "typed" };
  // 自分で打った ID を固定しているならそのまま
  if (saved && source === "typed") return { targetId: saved, pinned, source };
  // 連携 ID があればそれ（連携 ID から入れた値で、設定の ID が変わっていたら追従）
  if (linked) return { targetId: linked, pinned, source: "linked" };
  return { targetId: saved, pinned, source };
}

/**
 * 入力した ID が設定の自分の ID と同じ人を指すか（空欄は自分）。
 * 自動接続（自分の配信開始を待つ）を止めるかどうかの判定に使う。記録するかどうかはサーバが決める
 * （/api/platforms/whowatch/live の isOther）ので、ここでは候補（w: / t:）の重なりで判定する。
 * 大文字小文字は区別する（ふわっちの ID は区別される）
 */
export function isOwnWhowatchTarget(typed: string | null | undefined, linkedId: string | null | undefined): boolean {
  const t = (typed ?? "").trim();
  if (!t) return true;
  const own = (linkedId ?? "").trim();
  if (!own) return false;
  const a = normalizeWhowatchUserPath(t).candidates;
  const b = new Set(normalizeWhowatchUserPath(own).candidates);
  return a.some((c) => b.has(c));
}
