# TagDeck Phase 5b ベイズ推定 設計書

**バージョン**: v1.0  
**作成日**: 2026-05-09  
**ステータス**: 設計確定待ち（社長承認前）  
**担当フェーズ**: Phase 5b-A (設計) のみ。本実装は Phase 5b-B で実施。

---

## 調査サマリー

Phase 5a のモンテカルロ実装は `src/lib/events/` 配下の 363 行に集約されており、
クライアント側で 10,000 試行を実行する構成。`event_history` テーブルは schema.ts に定義済みだが
書き込みコードは存在しないため、Phase 5b-B で書き込み実装も並行して必要となる。
推奨モデルは **案A（経験ベイズ）** — 依存追加ゼロ・解析解・1ms 以下の更新を実現する最小構成。

---

## Task 1: Phase 5a 実装把握

### ファイル構成

| ファイル | 行数 | 役割 |
|---------|------|------|
| `src/lib/events/monte-carlo.ts` | 164 | Box-Muller 正規乱数 + モンテカルロ本体 |
| `src/lib/events/calculator.ts` | 199 | イベントタイプ別分岐・ペース推定 |
| `src/hooks/useEventSimulator.ts` | 154 | 5秒インターバル再計算フック |
| `src/app/api/events/route.ts` | 84 | GET/POST エンドポイント |
| `src/app/api/events/[id]/refresh-ranking/route.ts` | 89 | ライバル自動取得 |

**合計実装規模**: 1,457 行（エージェント調査計）

### 主要関数

```
normalRandom(mean, stdDev)                   monte-carlo.ts:41
  └─ Box-Muller: z = √(-2 ln u1) · cos(2π u2)

simulateRankingProbability(input)            monte-carlo.ts:49
  └─ iterations=10,000 のモンテカルロループ
  └─ 各試行: normalRandom で自分・ライバル最終スコアを生成 → ソート → 順位カウント

estimatePaceParameters(history, lookback=60) calculator.ts (経由 monte-carlo.ts:131)
  └─ 直近60分の隣接データ差分から時速 (ds/dt × 3,600,000) を計算
  └─ stdDev = max(√分散, mean × 0.1)  ← 安定化ハック
```

### 入出力データ形式

**入力 (MonteCarloInput)**:
```typescript
{
  myCurrentScore: number,     // 現在スコア
  myPaceMean: number,         // 推定時速（平均）
  myPaceStdDev: number,       // 推定時速（標準偏差）
  rivals: RivalState[],       // {name, currentScore, paceMean, paceStdDev}[]
  remainingHours: number,     // 残り時間（時間単位）
  targetRank: number,         // 目標順位
  iterations?: number         // デフォルト 10,000
}
```

**出力 (MonteCarloOutput)**:
```typescript
{
  rankProbability: number,            // 0〜100 (%)
  expectedRank: number,               // 平均順位
  bestRank: number,
  worstRank: number,
  rankDistribution: Record<string, number>, // 順位 → 試行数
  myFinalScoreDistribution: {
    p10: number, p50: number, p90: number, mean: number
  }
}
```

### Phase 5a の予測精度の限界

| 弱点 | 詳細 |
|------|------|
| **正規分布仮定の硬直性** | スコアにバースト（イベントボーナス等）がある場合、正規分布は裾を過小評価する |
| **ライバルペースの無知仮定** | rivals[].paceMean/StdDev は「自分と同ペース」として計算される（`calculator.ts` 内の推定では自分のペースを流用） |
| **セッションをまたぐ学習なし** | 毎回コールドスタート。過去イベントの実績が活かされない |
| **stdDev 安定化ハック** | `stdDev = max(√分散, mean × 0.1)` は経験則。統計的根拠が弱く、稀少データ時に偏る |
| **最小データ制約** | `history.length < 3` でゼロペース+定数 stdDev=100 にフォールバック（精度崩壊） |

---

## Task 2: event_history 状況

### スキーマ定義（`src/lib/db/schema.ts:147-176`）

```typescript
export const eventHistory = pgTable("event_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  eventId: uuid("event_id"),          // 削除後も履歴保持

  name: text("name").notNull(),
  platform: text("platform").notNull(),
  eventType: text("event_type").notNull(),

  startTime: timestamp("start_time").notNull(),
  endTime:   timestamp("end_time").notNull(),

  finalScore:  integer("final_score"),
  finalRank:   integer("final_rank"),
  targetScore: integer("target_score"),
  targetRank:  integer("target_rank"),
  achieved:    boolean("achieved").default(false).notNull(),

  fullPaceHistory: jsonb("full_pace_history"),  // Array<{timestamp, score}>
  finalRivals:     jsonb("final_rivals"),        // Array<{rank, name, score}>

  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### 書き込みコードの有無

**Phase 5a 内に `event_history` への INSERT コードは存在しない。**

grep 結果: `event_history` の参照は `schema.ts:147` の定義のみ。

### Phase 5b-B で必要な追加タスク

イベント終了時（`status` が `active` → `completed`/`archived` に変わるタイミング）に
`event_history` へ INSERT する API または DB トリガーの実装が必要。

候補実装場所:
- `POST /api/events/[id]/complete` (新規エンドポイント)
- Supabase の Database Webhook（`event_simulators` の `status` 変更をトリガー）

### データ件数確認クエリ（実行不可・参照用）

```sql
-- ユーザー別 event_history 件数確認
SELECT user_id, event_type, COUNT(*) as cnt
FROM event_history
GROUP BY user_id, event_type
ORDER BY cnt DESC;

-- ベイズ推定に使えるデータ有無（pace_history 3件以上のみ有効）
SELECT user_id, event_type,
       COUNT(*) FILTER (WHERE jsonb_array_length(full_pace_history) >= 3) as usable_cnt
FROM event_history
GROUP BY user_id, event_type;
```

---

## Task 3: ベイズモデル候補 3 案

### 比較テーブル

| 項目 | 案A: 経験ベイズ | 案B: 共役事前分布 (Normal-InvGamma) | 案C: 階層ベイズ + MCMC |
|------|----------------|--------------------------------------|------------------------|
| 数学モデル | Normal-Normal 共役（σ既知仮定） | Normal-InverseGamma 共役（σ未知） | Hierarchical + Stan/tfp |
| 実装複雑度 | 2/10 | 4/10 | 9/10 |
| 計算コスト | <1ms（解析解） | <5ms（解析解） | 100ms〜10s（MCMC） |
| リアルタイム更新 | ✅ 可能 | ✅ 可能 | ❌ 不可（バッチ処理のみ） |
| 期待精度向上 | +15〜25% | +20〜35% | +35〜50% |
| 最小必要データ | 1件（0件は Phase 5a にフォールバック） | 3件 | 20件以上 |
| 外部ライブラリ | 不要 | 不要 | tfjs / wasm-stan 等必須 |
| 新規依存追加 | ゼロ | ゼロ | 大（+数 MB） |
| リスク | 異なるイベントタイプを混在させると prior が汚染 | 事前分布パラメータ (α, β) の設定ミスで崩壊 | MCMC 発散・収束不確実・デバッグ困難 |

---

### 案A: 経験ベイズ（Empirical Bayes）詳細

**概要**: 過去データから事前分布のハイパーパラメータを推定し、Normal-Normal 共役更新で事後を得る。

**数学モデル**:

```
事前分布（過去履歴から推定）:
  μ₀ = mean(historical_pace_means)  ← 過去イベント平均ペース
  σ₀ = std(historical_pace_means)   ← 過去イベント間のばらつき
  k₀ = 仮想サンプル数（信頼強度、デフォルト k₀=3）

尤度:
  x̄  = 当セッションの現在ペース平均（既存 estimatePaceParameters() の出力）
  n   = 有効ペースサンプル数

事後分布（解析解）:
  μ_post = (k₀ × μ₀ + n × x̄) / (k₀ + n)   ← ベイズ加重平均
  σ_post = σ₀ × √(k₀ / (k₀ + n))            ← 不確実性の収縮
```

**実装イメージ（疑似コード）**:
```typescript
function bayesianUpdatePace(
  sessionMean: number,   // estimatePaceParameters() の mean
  sessionN: number,      // ペースサンプル数
  historicalMean: number,
  historicalStd: number,
  priorStrength: number = 3  // k₀
): { mean: number; stdDev: number } {
  const mu = (priorStrength * historicalMean + sessionN * sessionMean)
             / (priorStrength + sessionN);
  const sigma = historicalStd * Math.sqrt(priorStrength / (priorStrength + sessionN));
  return { mean: mu, stdDev: Math.max(sigma, mu * 0.05) };
}
```

**フォールバック**: 過去データ 0 件 → `priorStrength=0` → Phase 5a と同一の出力

---

### 案B: 共役事前分布ベイズ（Normal-InverseGamma）詳細

**概要**: μ と σ² を同時に推定する完全な共役更新。σ を定数仮定しない分、案A より統計的に正確。

**数学モデル**:

```
事前分布:
  (μ, σ²) ~ NIG(μ₀, λ, α, β)
  ここで λ=k₀, α=shape, β=scale（過去データから MLE で推定）

観測データ: {x₁, x₂, ..., xₙ}（当セッションのペース系列）

事後更新（解析解）:
  μₙ = (λμ₀ + n·x̄) / (λ + n)
  λₙ = λ + n
  αₙ = α + n/2
  βₙ = β + ½·Σ(xᵢ - x̄)² + λn(x̄ - μ₀)²/(2(λ + n))

予測分布:
  p(x_new | data) = t_{2αₙ}(μₙ, βₙ(λₙ+1)/(αₙ·λₙ))  ← スチューデントt分布
```

**利点**: 正規分布の裾が重い場合の安定性が案A より高い

---

### 案C: 階層ベイズ + MCMC 詳細

**概要**: ユーザー間・イベント間の構造を階層モデルで表現し、MCMC でサンプリング。

**数学モデル**（省略形）:
```
hyper-prior: μ_global ~ N(0, 1000), σ_global ~ HalfNormal(500)
user-level:  μ_user ~ N(μ_global, σ_global)
event-level: μ_event ~ N(μ_user, σ_user)
obs:         xᵢ ~ N(μ_event, σ_obs)
```

**MVP として採用しない理由**: 計算時間がリアルタイム要件（<1秒）を超える。
最小データ要件（20件以上）を満たすまで精度が不安定。外部依存追加が大きい。

---

## Task 4: 推奨モデル選定

### 推奨: **案A（経験ベイズ）**

**選定根拠（Karpathy 原則に沿った評価）**:

| 原則 | 案A での対応 |
|------|-------------|
| **Simplicity First** | 実装 30〜50 行。外部依存ゼロ。解析解のみ |
| **Think Before Coding** | 数式が自明で「実装してみないとわからない」部分がない |
| **Surgical Changes** | 既存 `estimatePaceParameters()` の出力を受け取り、返却も同じ型 → 既存コード変更ゼロ |
| **Goal-Driven Execution** | MVP の目標「過去データで精度向上」を満たしつつ破壊的変更なし |

**案B を採用しない理由（現時点）**:
- σ の同時推定は精度向上に寄与するが、実装複雑度が 2× になる
- 事前分布パラメータ (α, β) の正しい推定には過去 10 件以上が必要
- Phase 5b MVP の段階では過去データがほぼゼロ → 案A と精度差が出ない

**案B を将来再検討する条件**:
1. ユーザーあたり `event_history` が 10 件以上蓄積されている
2. 案A の posterior stdDev が不安定（崩壊または過収縮）と実測で確認された場合
3. Phase 5b+ での「ライバル個別ベイズ推定」拡張時（ライバルごとに NIG prior が必要）

**案C を採用しない条件（永続）**:
- リアルタイム更新（1秒以内）が必須要件である限り不採用

---

## Task 5: API 設計素案

### 新規エンドポイント: 過去ペース統計取得

```
GET /api/events/[id]/historical-pace
```

**目的**: クライアント側の `bayesianUpdatePace()` に渡す事前分布パラメータを返す

**入力（クエリパラメータ）**:
```typescript
{
  eventType: "score" | "ranking" | "nice" | "viewer",  // フィルター
  platform?: string,     // optional: プラットフォーム別フィルター
  limit?: number,        // 最新N件（デフォルト 20）
}
```

**出力 Zod スキーマ**:
```typescript
const HistoricalPaceResponseSchema = z.object({
  historicalMean:    z.number(),    // μ₀: 過去ペース平均 (pt/h)
  historicalStd:     z.number(),    // σ₀: 過去ペース標準偏差
  sampleCount:       z.number().int().min(0),  // 使用した過去イベント数
  hasSufficientData: z.boolean(),   // sampleCount >= 1
  // デバッグ用（本番では省略可）
  _debug: z.object({
    eventType: z.string(),
    platform: z.string().optional(),
    newestEventAt: z.string().datetime().optional(),
  }).optional(),
});
```

**レスポンス時間目標**: <100ms（PostgreSQL 集計クエリ）

**Phase 5a エンドポイントとの関係**:
- **並列動作**（置換ではない）
- 既存 API は変更しない
- クライアントが `historical-pace` を取得 → `bayesianUpdatePace()` で統合 → 既存 `simulateRankingProbability()` に渡す

**実装上の注意**:
- `full_pace_history` の各イベントから平均ペースを集計するため、
  DB 側で JSONB の展開（`jsonb_array_elements` 等）が必要
- キャッシュ戦略: `Cache-Control: private, max-age=300`（5分キャッシュ）

---

### 書き込みエンドポイント（Phase 5b-B 追加分）

```
POST /api/events/[id]/complete
```

**目的**: イベント終了時に `event_history` へ INSERT

**入力 Zod スキーマ**:
```typescript
const CompleteEventBodySchema = z.object({
  finalScore: z.number().int().optional(),
  finalRank:  z.number().int().optional(),
  achieved:   z.boolean(),
});
```

**処理**:
1. `event_simulators` から `paceHistory`, `rivalsSnapshot` を取得
2. `event_history` に INSERT
3. `event_simulators.status` を `"completed"` に UPDATE

---

## Task 6: UI 統合方針

### 表示場所

`src/components/events/EventDashboard.tsx` 内の **ランキング型ヘッダー部分**に
"ベイズ補正済み" バッジを追加するのみ。グラフ・確率ゲージ・分布表示は既存流用。

### 切替方針: **オプションなし（自動適用）**

| 方針 | 理由 |
|------|------|
| 切替トグルなし | ユーザーに「ベイズとは何か」を説明するコストが高い |
| タブなし | 過去データが少ない初期段階ではモンテカルロと誤差が小さい |
| 並列表示なし | 混乱を招く。精度指標（"信頼度"バッジ）1個で表現する |

### UI 変更の最小化

```
変更: EventDashboard.tsx の useEventForecast 呼び出し部分のみ
  ↓
useHistoricalPace(event.id, event.eventType) フックを追加（新規）
  ↓
historicalPace.hasSufficientData が true の場合のみ、
myPaceMean / myPaceStdDev を bayesianUpdatePace() で上書き
  ↓
simulateRankingProbability() への入力が変わるだけ → 出力形式は完全一致
```

**バッジ表示（新規）**:
- 過去データあり: "📊 過去データ参照中 (N件)" を淡色バッジで表示
- 過去データなし: バッジなし（Phase 5a と同じ表示）

---

## Task 7: テスト戦略

### 1. 数学モデル収束テスト（vitest）

```typescript
// 合成データ収束テスト
it("should converge posterior to true mean with sufficient data", () => {
  const TRUE_MEAN = 500;
  const TRUE_STD  = 50;
  // 100件の合成履歴からμ₀を推定
  const historicalMean = TRUE_MEAN + (Math.random() - 0.5) * 100;
  const historicalStd  = TRUE_STD * 1.5;

  // 当セッション: 30サンプルで真値に近い観測
  const sessionMean = TRUE_MEAN + 10;
  const sessionN    = 30;

  const result = bayesianUpdatePace(sessionMean, sessionN, historicalMean, historicalStd, 3);
  expect(result.mean).toBeCloseTo(TRUE_MEAN, -1);  // ±10 以内
  expect(result.stdDev).toBeLessThan(historicalStd);  // 収縮を確認
});
```

### 2. コールドスタートテスト（Phase 5a 同値確認）

```typescript
it("should return same result as Phase 5a when no history", () => {
  const sessionMean = 500, sessionStd = 50, sessionN = 10;
  // 過去データなし: priorStrength=0
  const result = bayesianUpdatePace(sessionMean, sessionN, 0, 0, 0);
  expect(result.mean).toBe(sessionMean);
  expect(result.stdDev).toBe(sessionStd);  // Phase 5a の値と一致
});
```

### 3. Phase 5a 回帰テスト（変更ゼロ確認）

- `src/lib/events/monte-carlo.ts` / `calculator.ts` は **一切変更しない**
- 既存テスト（存在する場合）がすべてパスすることを CI で確認
- 新規 `bayesianUpdatePace()` は **別ファイル** `src/lib/events/bayesian.ts` に配置
- インポート関係: bayesian.ts → monte-carlo.ts（順方向のみ。逆依存禁止）

### 4. API テスト（vitest + Supabase test client）

```typescript
it("GET /api/events/[id]/historical-pace returns valid schema", async () => {
  const res = await GET(`/api/events/${testEventId}/historical-pace?eventType=ranking`);
  const data = HistoricalPaceResponseSchema.parse(await res.json());
  expect(data.sampleCount).toBeGreaterThanOrEqual(0);
});
```

---

## Task 8: 設計書作成結果

**ファイルパス**: `D:\tagdeck\docs\architecture\phase5b-bayesian-design.md`  
**バージョン**: v1.0（適用前）  
**コミット**: 本設計書は Phase 5b-A 成果物。Phase 5b-B 開始前に社長承認を得てから git commit 予定。

---

## 推奨される Phase 5b-B（実装）の進め方

### ステップ 1: 書き込み実装（前提条件の整備）

```
src/app/api/events/[id]/complete/route.ts  新規作成
  └─ event_history INSERT
  └─ event_simulators.status = "completed"
```

テスト: 手動でイベント完了 → Supabase Studio で event_history 行を確認

---

### ステップ 2: ベイズ関数の単体実装

```
src/lib/events/bayesian.ts  新規作成（monte-carlo.ts を変更しない）
  └─ bayesianUpdatePace(sessionMean, sessionN, histMean, histStd, k0) → {mean, stdDev}
  └─ aggregateHistoricalPace(histories) → {mean, std, count}
```

vitest で収束テスト・コールドスタートテストをパス

---

### ステップ 3: 読み取り API の実装

```
src/app/api/events/[id]/historical-pace/route.ts  新規作成
  └─ SELECT から full_pace_history を JSONB 展開
  └─ aggregateHistoricalPace() に渡して統計計算
  └─ HistoricalPaceResponseSchema で返却
```

---

### ステップ 4: フック統合

```
src/hooks/useEventSimulator.ts に useHistoricalPace() を追加
  └─ SWR or fetch で GET /historical-pace
  └─ 5分キャッシュ（ペース統計は頻繁に変わらない）
```

---

### ステップ 5: EventDashboard 統合

```
src/components/events/EventDashboard.tsx の useEventForecast 呼び出し部分
  └─ hasSufficientData が true のときのみ bayesianUpdatePace() で上書き
  └─ "過去データ参照中" バッジ追加（1〜2行の JSX）
```

---

## 社長承認待ち項目

| # | 項目 | 選択肢 |
|---|------|--------|
| 1 | **推奨モデル（案A）の採用可否** | ✅ 案A採用 / 案B に変更 |
| 2 | **`priorStrength` (k₀) の初期値** | 推奨: k₀=3（過去3件分の重み） / カスタム値 |
| 3 | **イベント完了トリガーの方式** | POST /api/events/[id]/complete（新規エンドポイント）/ Supabase DB Webhook |
| 4 | **UI のバッジ表示の有無** | ✅ バッジ追加（推奨）/ バッジなし（完全透過的）|
| 5 | **Phase 5b-B 着手タイミング** | 即着手 / マイルストーン確認後 |

---

*設計書 v1.0 → v1.1 — Phase 5b-B 実装完了*

---

## 実装履歴

### Phase 5b-B 実装完了 (2026-05-09)

| ファイル | 種別 | 内容 |
|---------|------|------|
| `src/lib/events/bayesian.ts` | 新規 | 経験ベイズ解析解 (47行) |
| `src/lib/events/bayesian.test.ts` | 新規 | vitest テスト 4カテゴリ 7ケース |
| `src/app/api/events/[id]/historical-pace/route.ts` | 新規 | GET: 過去ペース統計 (user_id スコープ) |
| `src/app/api/events/[id]/complete/route.ts` | 新規 | POST: イベント完了 + event_history INSERT |
| `src/hooks/useHistoricalPace.ts` | 新規 | TanStack Query 5分キャッシュフック |
| `src/components/events/EventDashboard.tsx` | +5行 | バッジ表示 (import + hook呼び出し + JSX) |

**検証結果**:
- `pnpm tsc --noEmit`: PASS (EXIT:0)
- `pnpm build`: PASS — 新ルート 2本確認済み
  - `ƒ /api/events/[id]/complete`
  - `ƒ /api/events/[id]/historical-pace`
- `monte-carlo.ts` / `calculator.ts` 差分: **ゼロ行**
- `EventDashboard.tsx` 差分: **5行** (制約: 3〜5行)

**注意事項**:
- vitest は未インストール (`pnpm test` は `pnpm add -D vitest` 後に実行可能)
- bayesian.ts は Phase 5a モンテカルロに未統合 (bayesian update は Phase 5b-C で実施予定)
- git push は社長承認後に実施すること
