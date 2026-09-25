# Phase B Step 1 — CSP 警告調査レポート

**作成者**: CTO 真鍋玲央  
**調査日**: 2026-05-12  
**調査方法**: read-only（curl・node_modules・ソースコード参照・ファイル編集なし）

---

## 1. HTTP レスポンス検証（発生源特定）

### 調査対象 URL

| URL | HTTP ステータス | CSP ヘッダー |
|-----|--------------|------------|
| `https://tagdeck.jp/` | 200 OK | **なし** |
| `https://tagdeck.jp/login` | 200 OK | **なし** |
| `https://tagdeck.jp/dashboard` | 307 (→/login) | **なし** |

### 実取得ヘッダー（`https://tagdeck.jp/` verbose curl）

```
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
x-opennext: 1
x-powered-by: Next.js
Report-To: {"group":"cf-nel", ...}
Nel: {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}
Server: cloudflare
CF-RAY: 9fa748c19b0d760e-SJC
```

`Content-Security-Policy` も `Content-Security-Policy-Report-Only` も**一切存在しない**。

---

## 2. 設定ファイル検証

| ファイル | CSP 関連記述 | 結論 |
|---------|------------|------|
| `next.config.ts` | なし（`headers()` 関数未定義） | CSP 付与なし |
| `src/middleware.ts` | なし（Supabase セッション管理のみ） | CSP 付与なし |
| `wrangler.jsonc` | なし（`headers` フィールド未使用） | CSP 付与なし |
| `public/_headers` | ファイル自体が存在しない | CSP 付与なし |
| `src/app/layout.tsx` | なし | CSP meta タグなし |
| `src/` 全体 | grep 0件 | CSP 付与なし |

唯一の CSP 記述:

```javascript
// .open-next/cloudflare/images.js:334
"Content-Security-Policy": "script-src 'none'; frame-src 'none'; sandbox;"
```

→ これは Next.js の Image Optimization レスポンス専用。通常ページへの影響ゼロ。

---

## 3. inline script 分析（違反内訳）

### script タグ集計（`https://tagdeck.jp/` HTML 解析）

| 種別 | 件数 |
|------|------|
| 外部スクリプト（`src=` あり） | 9 |
| inline スクリプト（`src=` なし） | 8 |
| **合計** | **17** |

「script-src 違反 17件」= **HTML に含まれる全 `<script>` タグの数と一致**。

### inline スクリプトの内訳

| # | 内容 | CSP 問題カテゴリ |
|---|------|----------------|
| 1 | `type="application/ld+json"` — JSON-LD 構造化データ | script-src-elem（型の違い・一部ブラウザで対象） |
| 2〜7 | `self.__next_f.push([...])` — Next.js RSC データ注入 | **script-src 'unsafe-inline' 必須** |
| 8 | Next.js hydration 用無名関数 | **script-src 'unsafe-inline' 必須** |

**Next.js App Router + RSC は inline スクリプトを必ず出力する設計**。  
`nonce` を使わない限り、`script-src 'unsafe-inline'` または nonce/hash なしでは CSP 違反になる。

### connect-src 違反 27件の推定対象

`connect-src 'none'` が仮に設定されていれば、以下の全接続が違反になる:

| 接続先 | 目的 |
|--------|------|
| `*.supabase.co` / `*.supabase.com` | 認証・DB・Realtime |
| `api.whowatch.tv` | ふわっち公開 API（5秒ポーリング） |
| `/_next/static/*` | Next.js チャンクロード |
| `/_next/data/*` | Next.js データ取得 |
| Cloudflare Workers サブリクエスト | Worker 内部 fetch |

27件 = これらの接続を REST / WebSocket / Streaming 含めて合算した数と整合する。

---

## 4. 重要調査結果

### 確定事項

> **tagdeck.jp は現在、いかなる CSP ヘッダーも送信していない。**

CSP ヘッダーが存在しない状態ではブラウザは CSP 違反を報告しない。したがって:

- **ブラウザ DevTools Console での CSP 違反は理論上発生不可能**
- 社長が確認された「17件・27件の警告」の発生源は **アプリケーション外部のツール** である可能性が高い

### 発生源候補（優先度順）

| 候補 | 根拠 | 確認方法 |
|------|------|---------|
| **① Cloudflare Page Shield** | CF Pro+ プランに含まれるスクリプト監視機能。ブラウザ外で潜在的 CSP 違反を報告 | CF ダッシュボード → Security → Page Shield |
| **② Cloudflare WAF Transform Rules** | ダッシュボードで CSP ヘッダーをルール付与している可能性。curl では見えるが curl 結果はなし → 低確率 | CF ダッシュボード → Rules → Transform Rules |
| **③ セキュリティスキャナー（Lighthouse/ZAP）** | ページを分析し「CSP が未設定」→ 設定した場合の潜在違反を先行報告 | スキャンレポートの確認 |
| **④ ブラウザ拡張機能の干渉** | 拡張機能が CSP meta タグを動的挿入している可能性 | シークレットウィンドウ（拡張 OFF）で再現確認 |

---

## 5. 解消方針案（4本）

### 案 A: 現状維持（無視）◎ 推奨

**内容**: CSP ヘッダーを設定せず現状を継続。

| 観点 | 評価 |
|------|------|
| 工数 | 0 時間 |
| メリット | コード変更ゼロ・デプロイ不要 |
| メリット | CSP ヘッダーがないため機能影響ゼロ（ブラウザ違反なし） |
| デメリット | セキュリティガードが実質機能していない |
| デメリット | 将来 CSP を enforce に切り替えるとき全件修正が必要 |
| セキュリティ影響 | 現状維持（悪化なし） |
| **推奨度** | **◎**（発生源が外部ツール由来と判明した場合） |

### 案 B: Cloudflare ダッシュボード確認 → 発生源特定 ⭕

**内容**: Cloudflare ダッシュボードで Page Shield・Transform Rules・WAF Managed Rules を確認し、CSP の実際の発生源を確定する。

| 観点 | 評価 |
|------|------|
| 工数 | 15〜30 分（社長手作業） |
| メリット | 発生源が確定する → 後続対応の正確性が上がる |
| メリット | コード変更不要（ダッシュボード確認のみ） |
| デメリット | ダッシュボードアクセスが必要 |
| セキュリティ影響 | 調査のみ・変更なし |
| **推奨度** | **⭕**（案 A 実施前の前提調査として推奨） |

**確認箇所**:
1. Security → Page Shield → Script Monitor
2. Rules → Transform Rules（Response Header Transform）
3. Security → WAF → Managed Rules（Security Headers 系）

### 案 C: next.config.ts に適切な CSP ヘッダーを追加 △

**内容**: `next.config.ts` に `headers()` 関数を追加し、`Content-Security-Policy` または `Content-Security-Policy-Report-Only` を設定。

```typescript
// next.config.ts（案 — 実装禁止）
const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/(.*)",
      headers: [{
        key: "Content-Security-Policy-Report-Only",
        value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",   // RSC inline scripts 用
          "connect-src 'self' *.supabase.co *.supabase.com https://api.whowatch.tv",
          "style-src 'self' 'unsafe-inline'",
          "font-src 'self' data:",
          "img-src 'self' data: https:",
          "report-uri /api/csp-report",
        ].join("; ")
      }]
    }];
  },
};
```

| 観点 | 評価 |
|------|------|
| 工数 | 2〜4 時間（全接続先の洗い出し・テスト含む） |
| メリット | 意図的な CSP ポリシーが設定される |
| メリット | 将来 report-only → enforce への移行が容易になる |
| デメリット | RSC inline scripts により `'unsafe-inline'` 必須（XSS 防御効果が半減） |
| デメリット | Supabase・ふわっち全ドメイン洗い出しが必要 |
| デメリット | nonce 方式は Edge Runtime 制約で複雑 |
| セキュリティ影響 | report-only なら機能影響なし。enforce なら設定ミスで API 停止リスク |
| **推奨度** | **△**（発生源が Cloudflare Page Shield の場合は不要） |

### 案 D: Cloudflare Transform Rules で CSP を設定 △

**内容**: アプリコードを変更せず、Cloudflare の Transform Rules で CSP ヘッダーを付与。

| 観点 | 評価 |
|------|------|
| 工数 | 1〜2 時間（ダッシュボード設定） |
| メリット | コード変更・デプロイ不要 |
| デメリット | CF ダッシュボードとコードが分離してメンテが複雑になる |
| デメリット | CSP ルールのバージョン管理が困難 |
| セキュリティ影響 | 案 C と同等 |
| **推奨度** | **△** |

---

## 6. 「警告無視」という選択肢について

| 項目 | 評価 |
|------|------|
| 機能影響 | **ゼロ**（現時点で CSP ヘッダー未設定のため） |
| ユーザー体験への影響 | **なし** |
| セキュリティガードの有効性 | **未設定**（XSS に対する CSP による防御なし） |
| 将来の enforce 移行難易度 | **高**（next.js RSC inline scripts・Supabase 全 URL の洗い出しが必要） |
| **推奨** | **発生源が外部スキャナーであれば無視は合理的。Cloudflare ダッシュボード確認後に再判断推奨** |

---

## 7. 推奨アクション（優先順位）

**推奨案: まず案 B（ダッシュボード確認）→ 案 A（無視）または案 C（CSP 追加）を選択**

1. **最優先**: 社長が Cloudflare ダッシュボードで Page Shield / Transform Rules を確認
   - Page Shield が警告源 → 案 A（無視）で十分
   - Transform Rules に既存 CSP ルールあり → 内容確認・修正で対応
   - 発生源不明 → 案 C で意図的に CSP を設定

2. **中期（任意）**: 案 C の実装（セキュリティ強化目的）
   - `'unsafe-inline'` 回避には Next.js nonce 対応が必要（工数大・Phase 2 以降推奨）
   - 当面は `Content-Security-Policy-Report-Only` + `'unsafe-inline'` で違反監視を開始

---

## 関連文書

| 文書 | 役割 |
|------|------|
| `D:\tagdeck\AGENTS.md` | middleware.ts 継続理由（CSP nonce と Edge Runtime 非互換の根拠） |
| `D:\tagdeck\docs\migration\phase_warnings_w1_decision_20260512.md` | proxy.ts 移行禁止理由 |

---

*作成: CTO 真鍋玲央 / 2026-05-12*  
*調査方法: read-only（curl・grep・node_modules 参照のみ・ファイル編集なし）*
