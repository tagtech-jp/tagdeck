# TagDeck 棚卸しレポート (2026-05-11)

**作成者**: CTO 真鍋玲央  
**作成日**: 2026-05-11  
**対象**: `D:\tagdeck\` — TagDeck 本体（配信者向けセカンドスクリーン SaaS）  
**本番URL**: Cloudflare Workers + Vercel（デュアル構成）  
**制約**: read-only。既存ファイルへの変更ゼロ・新規作成このファイルのみ。

---

## 1. 現状サマリー(3行)

TagDeck は Next.js 16.2 + Cloudflare Workers + Supabase 構成の配信者向け SaaS で、ふわっち・Kick・ニコ生 3PF のリアルタイム監視・モンテカルロシミュレーター・ベイズ学習が main ブランチに実装済みで本番稼働中。  
Phase 3 計画書 v1.0（コメントビューア + AI接客カンペ + リスナーCRM）が 2026-05-11 EXT_AUDIT GO 判定を経て確定したが、**実装はまだ着手していない**。  
4本の未マージブランチ（LP/SEO/法務・Phase 2棚卸し・Phase 3計画書・在庫）が蓄積しており、Phase 3a-1 着手前にブランチ整理が必要な状態。

---

## 2. ディレクトリ構造(深さ2)

```
D:\tagdeck\
├── src/
│   ├── app/
│   │   ├── (auth)/          # ログイン・サインアップ
│   │   ├── (dashboard)/     # メインUI（events/crm/ai-prompter/settings 等）
│   │   ├── api/             # Route Handlers（platforms/fuwacchi/poll 等）
│   │   └── auth/            # Supabase Auth コールバック
│   ├── components/
│   │   ├── auth/ crm/ dashboard/ events/ nav/ settings/ shared/ stats/ ui/
│   ├── hooks/               # useKickMonitor / useFuwacchiMonitor / useNiconicoMonitor 等6本
│   ├── lib/
│   │   ├── db/              # Drizzle ORM スキーマ・クライアント
│   │   ├── events/          # イベント処理ロジック
│   │   ├── mock/            # モックデータ（MOCK_BASE_TIME 固定）
│   │   ├── platforms/       # PF別APIクライアント
│   │   ├── supabase/        # Supabase クライアント（server/client）
│   │   └── validations/     # Zod スキーマ
│   ├── stores/              # Zustand (platform-store / crm-filter-store)
│   └── types/               # listener / platform / stats 型定義
├── workers/
│   ├── fuwacchi-poller/     # Render Free 用 WebSocket中継（雛形のみ）
│   ├── kick-watcher/        # Kick 用（雛形のみ）
│   └── niconico-watcher/    # ニコ生用（雛形のみ）
├── drizzle/                 # Drizzle migration SQL (0000〜0003)
├── docs/
│   ├── architecture/        # fuwacchi_api_endpoints / phase5b-design / phase5c-design
│   ├── features/            # fuwacchi_sync_daily_ops
│   ├── legal/               # scraping-compliance-2026-05-09.md
│   ├── migration/           # Phase 3 計画書 v1.0 等 (本ファイル含む)
│   └── retrospectives/      # 2026-05-11 Phase 3 v1.0 振り返り
├── data/n8n_workflows/      # n8n workflow JSON
├── logs/                    # fuwacchi_sync_*.log
├── scripts/platforms/fuwacchi/ # (空ディレクトリ)
├── public/                  # icons / manifest.json
├── .github/workflows/       # (空ディレクトリ — CI 未設定)
├── CLAUDE.md / AGENTS.md
├── package.json / pnpm-lock.yaml / wrangler.jsonc
├── drizzle.config.ts / next.config.ts / open-next.config.ts
└── supabase_*.sql           # RLS / Phase 5 追加スキーマ
```

---

## 3. CLAUDE.md / README 要約

### CLAUDE.md

- 社長プロフィール: ADHD / ASD / 双極性障害。強み: 過集中。弱み: マルチタスク・優先順位
- TagDeck は TagTech 第7事業。事業化判断: 半年後 DAU・有料転換率・解約率・月商 ¥300,000
- ⚠️ **旧パス記載**: 「裏キック団は `D:\TagmeTech` に存在」 → 正しくは `D:\urakick\`（§9にて確認）

### AGENTS.md（主要制約抜粋）

| カテゴリ | 制約 |
|---|---|
| 法務（最重要） | ふわっち: 公開 API 5秒ポーリングのみ。非公式 WS は CISO+CLO 合議承認まで禁止 |
| Cloudflare Workers | バンドル 25MiB 上限・CPU 10ms/request。重いライブラリは `next/dynamic` 必須 |
| Next.js 16.2 | middleware.ts → proxy.ts。params / searchParams は必ず await |
| Supabase Realtime | channel().on().subscribe() をチェーンで一気に呼ぶ。後から on() 追加禁止 |
| shadcn/ui | base-nova 移行済み。ToggleGroup は value が配列型（Radix UI と API 差異）|
| .env.local | 特殊文字は URL エンコード必須。DATABASE_URL は Transaction Pooler |

### README.md

create-next-app の標準テンプレートのまま。プロジェクト固有の説明は CLAUDE.md/AGENTS.md に集約されている。

---

## 4. 直近30コミット要約 + PR #13 詳細

### main ブランチ（全20コミット・最新→旧）

| # | ハッシュ | 日付 | 内容 |
|---|---------|------|------|
| 1 (最新) | 4bc6323 | 05-09 | chore: ふわっち daily sync schtasks 暫定対応 |
| 2 | 3c7be15 | 05-09 | fix: Phase 5c-beta extension バグ修正 |
| 3 | 052218c | 05-09 | feat: Phase 5c-β n8n 日次 fuwacchi auto sync |
| 4 | b259b78 | 05-09 | feat: Phase 5c-β ふわっちイベント一覧API + アイテムマッピング |
| 5 | 65dfe38 | 05-09 | chore: vitest テストスクリプト追加 |
| 6 | 65d0c25 | 05-09 | chore: Phase 5b vitest 追加 |
| 7 | dbab374 | 05-09 | feat: Phase 5b 経験的ベイズ（ペース学習） |
| 8 | 7cd9605 | 05-09 | feat: RLS Phase 5 SQL（users/event_simulators/event_history） |
| 9 | 6b68979 | 05-09 | fix: X OAuth コールバックログ強化 |
| 10 | b0afb91 | 05-08 | fix: sw.ts TypeScript + AGENTS.md + モックデータ更新 |
| 11 | 3c0fa0d | 05-08 | feat: Phase 5a モンテカルロ + ランキング順位シミュレーション |
| 12 | 4942a5c | 05-08 | feat: Phase 4c MVP — ニコ生ライブポーリング連携 |
| 13 | 21d1e76 | 05-08 | feat: Phase 4b — Kick 公式 Pusher WebSocket |
| 14 | 66ba213 | 05-08 | refactor: middleware.ts → proxy.ts（Next.js 16.2 対応） |
| 15 | aec2edd | 05-08 | fix: Realtime チャンネル subscribe-after-on エラー修正 |
| 16 | ee5cd57 | 05-08 | feat: Phase 4a — ふわっちポーリング実装 |
| 17 | 80db6f6 | 05-07 | feat: Phase 3（初期）— ダッシュボード UI CRM + stats パネル |
| 18 | 99c7c9a | 05-07 | feat: Phase 2 — 認証（email + OAuth） |
| 19 | 45c30c5 | 05-07 | fix: reactCompiler 無効化・dev serwist 無効化 |
| 20 | 7f9bf54 | 05-07 | chore: 初期コミット — TagDeck プロジェクトスケルトン |

### PR #13 "squash 4dbe566" の調査結果

```
$ git show 4dbe566
fatal: ambiguous argument '4dbe566': unknown revision or path in the working tree.
```

**コミット hash `4dbe566` は存在しない。** PR #13 がリポジトリに反映された形跡はない。  
詳細は §8・§9 参照。

---

## 5. ブランチ状況

| ブランチ | 最新コミット | 日付 | 内容 | main とのマージ状態 |
|---------|------------|------|------|-------------------|
| `main` | 4bc6323 | 05-09 | Phase 5c-β 暫定 schtasks | — |
| `feature/phase2-beta` | 5289f0b | 05-09 | Phase 2-β 棚卸し + 計画書 v1.0 | ❌ 未マージ |
| `feat/lp-seo-public-20260510` | 81fa418 | 05-10 | LP刷新+SEO+法務+noindex解除+BetaBanner | ❌ 未マージ |
| `chore/inventory-20260510` | 9586a31 | 05-10 | 棚卸しレポート v1 (前回) | ❌ 未マージ |
| `docs/phase3-plan-v01-20260510` | aa72569 | 05-11 | Phase 3 計画書 v1.0 (8コミット完了) | ❌ 未マージ |

**4本すべて main に未マージ。** GitHub Actions CI は `.github/workflows/` が空ディレクトリのため未設定。

---

## 6. テスト・CI/CD構成

### テスト

| 種別 | 状況 | 備考 |
|------|------|------|
| フレームワーク | **Vitest** `^4.1.5` | package.json: `"test": "vitest run"` |
| テストファイル | `src/**/*.test.ts` → **0件**。`src/**/*.spec.ts` → **0件** | `node_modules` 除外済み |
| vitest.config | 設定ファイル未確認（node_modules 内包の可能性） | |
| 追加コミット | 65dfe38 "add test scripts for vitest" / 65d0c25 "add vitest for Phase 5b" | コード確認できず |
| pytest | **使用なし**（プロジェクト内に pytest 設定・*.py なし） | |

**「pytest 1325 PASS」についての調査結果**: D:\tagdeck\ には pytest 設定も .py テストファイルも存在しない。Vitest を使用するこのプロジェクトでの「1325」件の根拠は現時点で確認不能。§8 にて詳述。

### CI/CD

| 項目 | 状態 |
|------|------|
| GitHub Actions | ❌ 未設定（`.github/workflows/` 空ディレクトリ） |
| Cloudflare デプロイ | `opennextjs-cloudflare deploy`（手動 or Cloudflare Dashboard CI） |
| wrangler.jsonc | name: "tagdeck" / nodejs_compat / 互換日 2026-05-01 |
| open-next.config.ts | Cloudflare Workers 向け設定 |

---

## 7. TODO/FIXME 一覧

```
grep 対象: src/**/*.{ts,tsx} — 結果: 0件
grep 対象: docs/**/*.md — 結果: 0件
```

**コードベース内に TODO / FIXME / XXX は存在しない。**

docs 上の明示的な未完了事項（振り返り §4 より転記）:

| ID | 内容 | 担当 | 期限 | 状態 |
|---|---|---|---|---|
| L2-4 | v0.1 §1.2 stream_id NULL バグ → v0.2 化 | CTO | 任意(Phase 3a-1 前) | ✅ 完了(aa72569) |
| CISO #2 | feat/ciso-skip-docs-security → push → PR | CISO 葦原隼 | 5/16 | ❌ 未完了 |
| INC-20260509-001 | Hook 第3層実装(.env Read tool 対策) | CISO | 5/16 | ❌ 未完了 |
| T1, T2 | events 既存テーブル+RLS 確認 | CTO / CISO | Phase 3a-1 前 | ❌ 未完了 |
| T3.1〜T3.5 | Vault ラッパー関数実装・検証(Phase 3a-4 前) | CTO / CISO | Phase 3a-4 前 | ❌ 未完了 |

---

## 8. メモリ矛盾の解消(Phase 2 未着手 vs Phase 3 MERGED)

### 結論先出し

| 矛盾点 | 実態 |
|--------|------|
|「Phase 2 未着手」 | Phase 2（認証）は完了済み。未着手なのは **Phase 2-β（LP/SEO/法務ページ）** で、`feature/phase2-beta` ブランチに完成コードがあるが main 未マージ |
| 「Phase 3 MERGED (PR #13 squash 4dbe566)」 | **計画書 v1.0 が確定した** (2b3da72) だけ。実装コードのマージ事実はない。commit hash 4dbe566 はリポジトリ全体に存在しない |
| 「pytest 1325 PASS」 | プロジェクトは Vitest を使用。pytest 設定・.py テストファイルなし。「1325」の根拠確認不能 |
| 「累計事故ゼロ=38」 | 振り返りレポート(5edb781)時点で 31（セッション +6、開始時 25）。38 = 31 + 7 相当だが git 追跡外の記録であり確認不能 |

### 詳細解説

**Phase 2 と Phase 2-β の区別**:

| フェーズ | 内容 | コミット | 状態 |
|---|---|---|---|
| Phase 2 | 認証（email + OAuth） | 99c7c9a (05-07) | ✅ main に完了 |
| Phase 2-β | LP刷新 + SEO + BetaBanner + 法務ページ + noindex解除 | ff783da〜81fa418 (05-09/10) | 🔄 `feature/phase2-beta`・`feat/lp-seo-public` に完成・main 未マージ |

振り返りレポート §4.3 に「TagDeck Phase 2 (長期・未定)」と記載があるのは **Phase 2-β の main マージ**を指している。「Phase 2 が未着手」ではなく「Phase 2-β がまだ main に取り込まれていない」が正確な状態。

**Phase 3 MERGED の意味**:

振り返りレポートは「Phase 3 計画書 v1.0 の確定を本セッションの成果とした」。これは **設計完了** であり **実装 PR のマージではない**。`docs/phase3-plan-v01-20260510` ブランチには計画書・DB設計・EXT_AUDIT 往復文書が 8コミットあるが、実装コードは含まれず、main にも未マージ。

**「PR #13」の出処**:  
git 履歴にも GitHub API 応答にも PR #13 の痕跡はない。プロンプトに記載された squash hash `4dbe566` は存在しない。タスクプロンプトが将来の期待状態を過去事実として記述したか、別リポジトリの情報が混入したと判断する。

---

## 9. メモリ#30残課題の実体確認(4項目)

| # | 課題 | 確認方法 | 実体 |
|---|------|---------|------|
| 1 | PR #13 CI | `git show 4dbe566`; `.github/workflows/` 確認 | ❌ **PR #13 存在せず**。CI ワークフローも未設定（`.github/workflows/` 空ディレクトリ） |
| 2 | 設計書旧パス7箇所 | docs/**/*.md を grep "TagmeTech" | **1箇所のみ確認**: `CLAUDE.md:33` に `D:\TagmeTech` → 正しくは `D:\urakick\`。docs 内では0件。「7箇所」は別ブランチの docs/architecture/ ファイル群が対象の可能性（feature/phase2-beta 内のファイルは未確認） |
| 3 | 4ブランチ merge | `git branch -a` | ✅ **4本確認**: feature/phase2-beta / feat/lp-seo-public-20260510 / chore/inventory-20260510 / docs/phase3-plan-v01-20260510。全て main 未マージ |
| 4 | repo名リネーム | `wrangler.jsonc` / `package.json` 確認 | wrangler.jsonc: `"name": "tagdeck"` / package.json: `"name": "tagdeck"` で統一済み。GitHub 側のリポジトリ名については git remote からは確認不能（リモートログインなし） |

### 補足: CISO #2 の状態

振り返り §4.1 では「feat/ciso-skip-docs-security → push → PR、担当 CISO 葦原隼、期限 5/16、想定 30分」と記録。  
現在のブランチ一覧に `feat/ciso-skip-docs-security` は存在しない = **まだ作業着手していない**（期限は 2026-05-16 のため未切れ）。  
CISO #2 は「PR #13 に含まれる」という前提は git 上確認できない。

---

## 10. 次フェーズ候補(2〜4案)

### 案A: 4ブランチ整理 + Phase 2-β main 取り込み

| 項目 | 内容 |
|---|---|
| 案名 | Phase pre-3: ブランチ整理 + Phase 2-β マージ |
| 目的 | Phase 3a-1 着手前の負債清算。4本の未マージブランチを main に取り込みリポジトリを健全化する |
| DoD | ① `feat/lp-seo-public-20260510` を main にマージ（LP/SEO/法務ページ公開） ② `docs/phase3-plan-v01-20260510` を main にマージ（Phase 3 設計書公開） ③ `chore/inventory-20260510` をマージ or 削除（前回棚卸しレポートの帰属決定） ④ CLAUDE.md の `D:\TagmeTech` → `D:\urakick\` 1行修正 ⑤ `git status` で 0 件確認 |
| 所要時間 | 1〜2時間（コンフリクトは0〜少数・docs のみの差分） |
| リスク | 影響度:低 / 確率:低 / 対策: 各ブランチの diff は docs/src/public のみ。Cloudflare 自動デプロイが走るので Vercel Preview 確認を忘れない |
| 依存 | LP 公開に伴い `noindex` が外れるため、商標監視（J-PlatPat）が即開始される |
| 推奨度 | ★★★★★ |

---

### 案B: CISO #2 + INC-20260509-001 完了

| 項目 | 内容 |
|---|---|
| 案名 | CISO #2 + INC-20260509-001: セキュリティ負債 2件一括完走 |
| 目的 | 期限 5/16 の CISO タスク2件を週内に完了し、Phase 3a-1 着手前のリスク除去 |
| DoD | ① `feat/ciso-skip-docs-security` ブランチ作成 ② docs/security 自己参照を除外リストに追加（5件残） ③ push → PR 作成 ④ INC-20260509-001: .env Read tool 経由の第3層防護実装 ⑤ 両タスク Notion ステータス完了化 |
| 所要時間 | 1.5〜2時間（CISO #2: 30分 + INC: 60〜90分） |
| リスク | 影響度:中 / 確率:低 / 対策: コード変更は AGENTS.md・スキャン除外設定のみ。CI なしのため目視確認必須 |
| 依存 | 案A（ブランチ整理）と独立して着手可能 |
| 推奨度 | ★★★★☆ |

---

### 案C: Phase 3a-1 着手（バックエンド基盤）

| 項目 | 内容 |
|---|---|
| 案名 | Phase 3a-1: Render Free WebSocket サーバー構築 + YouTube/Google OAuth 追加 |
| 目的 | Phase 3 実装の第一歩。Render Free 上に Node.js WebSocket 中継サーバーを構築し、Supabase Realtime との結合を確立する |
| DoD | ① Render Free アカウント設定・Node.js ws サーバーデプロイ ② Supabase Auth に YouTube/Google OAuth 追加 ③ Render Worker → Supabase DB INSERT 疎通確認 ④ `workers/fuwacchi-poller/` 雛形実装 ⑤ Vitest で疎通テスト作成・PASS |
| 所要時間 | 1〜2日（分割: S1=Render アカウント+環境変数 30分 / S2=ws サーバー実装 2時間 / S3=Supabase 接続テスト 1時間） |
| リスク | 影響度:中 / 確率:中 / 対策: Render コールドスタート対策の Keep-alive ping 14分間隔必須（§9 R1）・UI 側 fetch timeout 60秒必須 |
| 依存 | Render Free アカウント（無料。要メール登録）。案A のブランチ整理完了後が理想 |
| 推奨度 | ★★★★☆ |

---

### 案D: TagOshi v0 構想着手

| 項目 | 内容 |
|---|---|
| 案名 | TagOshi v0: リスナー向けプロダクト設計開始 |
| 目的 | TagDeck 配信者データ × TagOshi リスナーデータの両側保有によるエコシステム形成に向け、Phase 3 計画書と対になる設計書を作成する |
| DoD | ① `D:\tagtech\docs\products\listener_product_concept_v0.md` を読んで現状把握 ② TagOshi Phase 0 計画書草稿（目的・MVP スコープ・TagDeck API 連携設計） ③ EXT_AUDIT 黒澤怜へのレビュー依頼書作成 |
| 所要時間 | 2〜4時間（完全 docs フェーズ・コード不要） |
| リスク | 影響度:低 / 確率:低 / 対策: Phase 3 着手前設計 = 完全分離可能 |
| 依存 | CLAUDE.md に明記「TagOshi 着手は TagDeck 課金成否で分岐」。現段階では課金実績ゼロのため判断保留が適切 |
| 推奨度 | ★★☆☆☆（依存条件未達） |

---

## 11. CTO 真鍋玲央 推奨

**推奨案: 案A（ブランチ整理 + Phase 2-β マージ）→ 即日 → 案B（CISO #2）→ 週内 → 案C（Phase 3a-1）**

理由: Phase 3 実装（案C）は Render アカウント準備という外部待機があるため「今すぐ着手できない」。その間に溜まった4ブランチ（案A: 1〜2時間）と期限付き CISO 負債（案B: 期限 5/16）を片付けることで、Phase 3a-1 着手時に main が完全にクリーンな状態になる。

**1セッション分割案**（社長の過集中強み・マルチタスク弱みを考慮）:

| セッション | 内容 | 目安時間 |
|---|---|---|
| S1 | 案A: 4ブランチ確認 + `feat/lp-seo-public` マージ + CLAUDE.md 旧パス修正 | 45分 |
| S2 | 案A: `docs/phase3-plan-v01` マージ + chore ブランチ帰属決定 | 30分 |
| S3（別日） | 案B: CISO #2 branch 作成 + push + PR | 30分 |
| S4（別日） | 案C: Render アカウント準備 + Phase 3a-1 開始 | 90分〜 |

案D（TagOshi）は TagDeck 課金成立後まで保留が合理的。

---

*レポート終了。既存ファイルへの変更ゼロ。次フェーズへの着手は社長承認後のセッションで実施。*
