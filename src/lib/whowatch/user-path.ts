// ふわっちの配信者 ID 入力の正規化（純関数・2026-09-30）。
// ブラウザ（ライブ画面の「自分の ID か」判定）とサーバ（/api/platforms/whowatch/live）の両方から使うため、
// サーバ専用の live-feed.ts から切り出した。このファイルは他のモジュールに依存しないこと。

/** URL が貼られた場合に ID 部分（prefix 付きも可）を取り出す。それ以外は入力のまま */
function stripProfileUrl(value: string): string {
  const m = /whowatch\.tv\/(?:profile\/)?([^/?#]+)/i.exec(value);
  if (!m) return value;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * 入力（ふわっちID・連携XのID・数値ID・プロフィールURL）を profile API のパス候補へ正規化する。
 * prefix が無い英数字はどちらの ID か判別できないため `w:` → `t:` の順に試す候補を返す。
 * ID 部分の大文字小文字は変換しない（`w:Thomas19981022` のように大文字始まりが実在する）。
 */
export function normalizeWhowatchUserPath(input: string): { path: string; candidates: string[] } {
  // 全角 ！(U+FF01) 〜 ～(U+FF5E) は対応する半角に直す（スマホからの貼り付け対策）
  const halfWidth = (input ?? "").replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const bare = stripProfileUrl(halfWidth.trim()).trim().replace(/^@/, "");

  const prefixed = /^(w|t|ふ):(.*)$/i.exec(bare);
  if (prefixed) {
    const id = prefixed[2];
    if (!id) return { path: "", candidates: [] };
    const prefix = prefixed[1] === "ふ" ? "w" : prefixed[1].toLowerCase();
    return single(`${prefix}:${id}`);
  }

  if (!bare) return { path: "", candidates: [] };
  if (/^\d+$/.test(bare)) return single(bare);
  return { path: `w:${bare}`, candidates: [`w:${bare}`, `t:${bare}`] };
}

function single(path: string): { path: string; candidates: string[] } {
  return { path, candidates: [path] };
}
