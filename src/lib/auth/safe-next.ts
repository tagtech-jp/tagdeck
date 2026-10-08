// ログイン後の戻り先（?next= / ?redirect=）を自分のサイト内のパスに限る（2026-10-08 セキュリティ監査）。
//
// /auth/callback と /auth/confirm は `${origin}${next}` で転送していた。origin は自分のサイトだが、next が
// "@evil.example" なら "https://tagdeck.jp@evil.example"（ユーザー情報付き URL で host は evil.example）、
// ".evil.example" なら "https://tagdeck.jp.evil.example" になり、ログイン直後に別サイトへ飛ばせる（オープンリダイレクト）。
// 受け付けるのは「/ で始まり、// や /\ で始まらない、制御文字を含まない」パスだけ。それ以外は既定の戻り先にする

export const DEFAULT_NEXT_PATH = "/dashboard";

/** 純関数: 戻り先として安全なサイト内パス（path + query + hash）を返す。安全でなければ fallback */
export function safeNextPath(next: string | null | undefined, fallback: string = DEFAULT_NEXT_PATH): string {
  if (typeof next !== "string") return fallback;
  const v = next.trim();
  if (v === "" || !v.startsWith("/")) return fallback;
  // "//host" と "/\host" はブラウザがスキーム相対 URL として別サイトに解釈する
  if (v.startsWith("//") || v.startsWith("/\\")) return fallback;
  // 制御文字・バックスラッシュ・空白は、URL の解釈が実装ごとに揺れるので受け付けない
  if (/[\u0000-\u0020\u007f\\]/.test(v)) return fallback;
  try {
    // 基準 URL に対して相対解決し、生成元が変わらないことを確かめる（"/@evil" 等はこの時点で同一生成元のパスになる）
    const base = "https://tagdeck.invalid";
    const u = new URL(v, base);
    if (u.origin !== base) return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}