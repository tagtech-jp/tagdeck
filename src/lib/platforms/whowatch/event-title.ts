// ふわっちイベントの表示名解決。
// whowatch.tv は Angular SPA で、サーバーが返す HTML は全ルート共通の空シェル + 共通タイトル
// 「ふわっち - みんなのライブ配信！」のみ（2026-07-19 実機確認）。per-event ページの HTML から
// 日本語イベント名を抽出することは構造的に不可能なため、スクレイピングは行わない。
// 表示名は「手動辞書（event-names.json） → 整形 event_key」の2段のみで解決する。
// 将来: バナー画像ピッカー（別タスクのスマホUI刷新）に置き換え予定。

import eventNamesDict from "./event-names.json";

const EVENT_NAMES: Record<string, string> = eventNamesDict as Record<string, string>;

/** event_key に対応する手動辞書エントリを返す。_readme キーは対象外。空文字/未登録は null。 */
function lookupEventName(eventKey: string): string | null {
  if (!eventKey || eventKey === "_readme") return null;
  const direct = EVENT_NAMES[eventKey];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  // 2026-07-24 実データ確認: event_key には YYYY_MM_ 日付プレフィックスが付く
  // (例: 2026_07_whowatchgrandprix)。辞書は無日付キー(例: whowatchgrandprix)で
  // 登録されているため完全一致だとヒットしない。プレフィックスを剥がして再照合する。
  const dated = eventKey.match(/^\d{4}_\d{1,2}_(.+)$/);
  if (dated) {
    const stripped = EVENT_NAMES[dated[1]];
    if (typeof stripped === "string" && stripped.trim()) return stripped.trim();
  }
  return null;
}

/**
 * event_key を人間可読な名称へ整形する（辞書未登録時のフォールバック）。
 * 先頭が `YYYY_MM_` の場合は「YYYY年M月 残り」に変換し、それ以外は単語区切りで先頭大文字化する。
 * 例: 2026_07_samba_carnival → "2026年7月 Samba Carnival"
 *     monthly_2026_05        → "Monthly 2026 05"（YYYY_MM_ 接頭辞ではないため無変換）
 */
export function humanizeEventKey(eventKey: string): string {
  if (!eventKey) return eventKey;

  const dated = eventKey.match(/^(\d{4})_(\d{1,2})_(.+)$/);
  if (dated) {
    const [, year, month, rest] = dated;
    const words = rest.split(/[_-]+/).filter(Boolean);
    const label = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    return `${year}年${Number(month)}月${label ? ` ${label}` : ""}`;
  }

  const words = eventKey.split(/[_-]+/).filter(Boolean);
  if (words.length === 0) return eventKey;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** 表示名の解決: 手動辞書 → 整形 event_key の2段のみ（badge_text / title_ja は使用しない）。 */
export function resolveEventDisplayName(eventKey: string): string {
  return lookupEventName(eventKey) ?? humanizeEventKey(eventKey);
}
