// スマホアプリ（Capacitor の WebView）からの API 呼び出しを許す CORS（2026-10-07・スマホアプリ化 第 1 段階）。
// 対象は /api/* だけ。許可する Origin は Capacitor の既定（Android: https://localhost、iOS: capacitor://localhost）と、
// 環境変数 TAGDECK_APP_ORIGINS（カンマ区切り。手元の開発用 http://localhost:5173 など）。
// アプリは Cookie ではなく Authorization: Bearer でログインを渡すので、Access-Control-Allow-Credentials は付けない
// （付けると Cookie 付きの越境要求を許すことになる）。許可リストに無い Origin には何も付けない（ブラウザが同一生成元の規則どおり拒む）。

export const DEFAULT_APP_ORIGINS: readonly string[] = ["https://localhost", "capacitor://localhost"];

/** 許可する Origin の集合。extra はカンマ区切り（空白は無視・空は無視） */
export function allowedAppOrigins(extra?: string | null): Set<string> {
  const out = new Set<string>(DEFAULT_APP_ORIGINS);
  for (const o of (extra ?? "").split(",")) {
    const v = o.trim().replace(/\/+$/, "");
    if (v) out.add(v);
  }
  return out;
}

export function isAllowedAppOrigin(origin: string | null | undefined, allowed: Set<string> = allowedAppOrigins(process.env.TAGDECK_APP_ORIGINS)): boolean {
  if (!origin) return false;
  return allowed.has(origin.trim().replace(/\/+$/, ""));
}

export const CORS_ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
export const CORS_ALLOW_HEADERS = "Authorization, Content-Type, Accept, X-Requested-With";

/** 許可した Origin に返すヘッダー（Vary: Origin でキャッシュの混線を防ぐ） */
export function corsHeadersFor(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function applyCorsHeaders(headers: Headers, origin: string): void {
  for (const [k, v] of Object.entries(corsHeadersFor(origin))) {
    if (k !== "Vary") {
      headers.set(k, v);
      continue;
    }
    // Vary は既存の値を壊さず Origin を足す（既に含まれていればそのまま）
    const existing = headers.get("Vary");
    if (!existing) headers.set("Vary", "Origin");
    else if (!existing.split(",").map((s) => s.trim().toLowerCase()).includes("origin")) headers.set("Vary", `${existing}, Origin`);
  }
}
