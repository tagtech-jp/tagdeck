// 別サイトからの書き込み要求（CSRF）を Origin ヘッダーで止める（2026-10-08 セキュリティ監査）。
//
// API ルートの認証はログイン Cookie（SameSite=Lax）か Authorization: Bearer で、Lax の Cookie は別サイトからの
// POST には付かないので、いまも CSRF は成立しにくい。ただし Cookie の属性だけに頼ると、属性が変わったとき
// （ライブラリの更新・設定変更）に気づけない。ブラウザは別サイトからの fetch / form の POST に必ず Origin を付けるので、
// /api/* への GET 以外の要求で Origin が付いていて、それが自分のサイトでもスマホアプリ（許可した Origin）でもなければ 403 にする。
// Origin が無い要求（同一サイトの一部の要求・curl・GitHub Actions の同期）はこれまでどおり通す（判定は各ルートの認証に任せる）

export const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export interface OriginGuardInput {
  method: string;
  pathname: string;
  /** 要求の Origin ヘッダー（無ければ null） */
  origin: string | null;
  /** 要求先のホスト（request.nextUrl.host。ポートを含む） */
  requestHost: string;
  /** スマホアプリなど、CORS で許可している Origin か */
  isAllowedAppOrigin: boolean;
}

/** 純関数: この要求を「別サイトからの書き込み」として拒むか */
export function isCrossSiteWrite(i: OriginGuardInput): boolean {
  if (!i.pathname.startsWith("/api/")) return false;
  if (SAFE_METHODS.has(i.method.toUpperCase())) return false;
  if (i.origin === null) return false;
  if (i.isAllowedAppOrigin) return false;
  try {
    return new URL(i.origin).host !== i.requestHost;
  } catch {
    // "null"（サンドボックス化された文書・プライバシー保護の転送）や壊れた値は別サイト扱い
    return true;
  }
}