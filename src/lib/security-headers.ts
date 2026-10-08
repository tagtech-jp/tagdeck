// 全応答に付けるセキュリティ関連のヘッダー（2026-10-08 セキュリティ監査）。
//
// 本番（tagdeck.jp）の応答には HSTS・X-Frame-Options・X-Content-Type-Options・Referrer-Policy が 1 つも無く、
// x-powered-by: Next.js が出ていた。ログイン画面を他サイトの iframe に埋め込める（クリックジャッキング）、
// 一度でも http:// で開くと中継者に Cookie を見られうる、といった既知の弱点を塞ぐ。
//
// 付け方は 2 か所（どちらも同じ値。片方だけ直さない）:
//   - Worker が返す応答（ページ・API）: next.config.ts の headers() が securityHeaderRules() を返す（OpenNext が応答に載せる）
//   - Cloudflare が Worker の手前で配る静的アセット（public/・_next/static）: public/_headers の /* ブロック
//     （中身はこのファイルの値を手で写す。静的ファイルは next.config.ts も middleware も通らないため。
//      src/lib/security-headers.test.ts が両者の一致を確かめる）
//
// CSP は「埋め込み禁止・<base> の差し替え禁止・プラグイン禁止」の 3 つだけ。script-src 等は Next の inline script・
// Supabase・ふわっちのコメントサーバー（wss）・Storage の音源を全部列挙しないと画面が壊れるので、別件で nonce 方式を設計してから入れる

export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // 1 年。includeSubDomains は tagdeck.jp 配下に別サービスを置く可能性があるので付けない（付けるなら社長決裁）
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
];

/** next.config.ts の headers() にそのまま返す形（全パス） */
export function securityHeaderRules(): Array<{ source: string; headers: Array<{ key: string; value: string }> }> {
  return [{ source: "/:path*", headers: SECURITY_HEADERS.map((h) => ({ ...h })) }];
}