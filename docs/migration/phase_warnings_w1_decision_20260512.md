# W-1 警告対応 決定証跡

**決定日**: 2026-05-12  
**決定者**: 社長（CEO）  
**記録者**: CTO 真鍋玲央  
**対象警告**:  
```
⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.
```

---

## 採用案: B（現状維持 + opennextjs-cloudflare 監視）

### 採用根拠（技術的事実）

| 事実 | 内容 |
|------|------|
| opennextjs-cloudflare@1.19.6 の実装 | `middleware.mjs` のみをバンドル。proxy.ts のサポートコードなし（`createServerBundle.js` にて確認）|
| proxy.ts のランタイム制約 | Node.js Runtime 専用。Edge Runtime 非対応 |
| opennextjs-cloudflare の middleware ラッパー | `cloudflare-edge`（Edge Runtime 前提）|
| 影響 | proxy.ts に移行すると Workers 上で Supabase セッション管理（認証リダイレクト・Cookie リフレッシュ）が完全に機能しなくなる |
| 警告の機能影響 | なし。pnpm dev 起動時に WARN として1回出力されるのみ |

### Phase CF-1 経緯

- Cloudflare Workers 移行前: AGENTS.md に「proxy.ts を使用せよ」と記載（Next.js 16.2 の公式推奨に従った）
- Phase CF-1（2026-05-12）: opennextjs-cloudflare@1.19.6 の node_modules を直接調査した結果、proxy.ts 対応コードが存在しないことを確認
- 決定: middleware.ts を継続使用し、AGENTS.md の矛盾記載を修正

---

## 不採用案（要約）

詳細は [phase_warnings_w1_options_20260512.md](phase_warnings_w1_options_20260512.md) を参照。

| 案 | 不採用理由 |
|----|-----------|
| A: proxy.ts リネーム | opennextjs-cloudflare が proxy.ts を未読み込み → 本番認証が壊れる（致命的）|
| C: console.warn フィルタ | 非公式ハック・メンテナンス負債・重要警告を誤って抑制するリスク |
| D: feature ブランチ試験 | コードで非対応を確認済み。工数対効果が低い |
| E: runtime='nodejs' 明示 | opennextjs-cloudflare の cloudflare-edge ラッパーと競合リスク大 |

---

## 将来の再評価条件

以下の条件が**両方**揃った時点で W-1 を再開し、案 A（proxy.ts 移行）を実施する:

1. **opennextjs-cloudflare がリリースノートで proxy.ts サポートを明記**  
   監視先: https://github.com/opennextjs/opennextjs-cloudflare/releases

2. **pnpm preview（opennextjs-cloudflare build → preview）で proxy.ts が動作することを検証済み**

再評価時の作業:
- `src/middleware.ts` → `src/proxy.ts` にリネーム
- `export async function middleware()` → `export async function proxy()` に改名
- `config` エクスポート（matcher）は変更不要
- AGENTS.md の「移行禁止」注記を削除

---

## 実施済み変更（本タスク）

| ファイル | 変更内容 |
|---------|---------|
| `D:\tagdeck\AGENTS.md` | 行 29〜33: proxy.ts 使用推奨 5行 → middleware.ts 継続使用 + 禁止理由 5行 に置換 |
| 本ファイル（新規作成）| W-1 採用記録 |

---

## 関連文書

| 文書 | 役割 |
|------|------|
| `D:\tagdeck\docs\migration\phase_warnings_investigation_20260512.md` | Step 1: W-1 警告の初期調査・切り分け |
| `D:\tagdeck\docs\migration\phase_warnings_w1_options_20260512.md` | Step 3: 方針案 A〜E の詳細比較 |
| `D:\tagdeck\AGENTS.md` | 本タスクで矛盾解消済み |

---

*記録: CTO 真鍋玲央 / 2026-05-12*
