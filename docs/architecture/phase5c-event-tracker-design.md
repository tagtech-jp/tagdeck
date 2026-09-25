# TagDeck Phase 5c イベント目標トラッカー 設計書

**バージョン**: v1.0  
**作成日**: 2026-05-09  
**ステータス**: 設計確定待ち（社長承認前）  
**担当フェーズ**: Phase 5c-α（設計）のみ。本実装は Phase 5c-β 以降で別途実施。

---

## 調査サマリー

ふわっちのポーリング基盤（5秒/25秒）と HTML ランキングパーサーは Phase 4a/5a で確立済みで流用可能。
イベント一覧 API は非公式（`api.whowatch.tv` 系、ドキュメントなし）のため 5c-β で実機確認が必要。
ニコ生の公式イベント API は廃止済みのため MVP は「ユーザーが URL 手動入力 + HTML スクレイピング」を基本とし、
アイテム→ポイント変換は「公式基準値テーブル（事前定義） × EMA 補正係数」の 2 層構成で実装する。

---

## Task 1: ふわっち既存実装棚卸し

### 1-1. 実装ファイル一覧

| ファイル | 行数 | 役割 |
|---------|------|------|
| `src/lib/platforms/fuwacchi.ts` | 81 | 公式 REST API クライアント (`api.whowatch.tv`) |
| `src/lib/platforms/fuwacchi-ranking.ts` | 174 | イベントランキング HTML パーサー |
| `src/app/api/platforms/fuwacchi/poll/route.ts` | 110 | 5秒ポーリング + 25秒ランキング更新 |
| `src/app/api/platforms/fuwacchi/monitor/route.ts` | — | 監視 start/stop 制御 |
| `src/app/api/platforms/fuwacchi/profile/route.ts` | — | ふわっちユーザーID 保存/取得 |
| `src/hooks/useFuwacchiMonitor.ts` | — | フロント監視フック |

### 1-2. イベント一覧・ランキング取得の実装状況

| 機能 | 実装状況 | 備考 |
|------|---------|------|
| ライブ一覧（自分の配信） | ✅ 実装済 | `GET /users/{userId}/lives_history` |
| イベントランキング（指定 URL） | ✅ 実装済 | `fetchEventRanking(url)` HTML パース |
| **イベント一覧プルダウン** | ❌ 未実装 | Phase 5c で新規追加 |
| アイテム種別取得 | ❌ 未実装 | Phase 5c で新規追加 |
| アイテム→ポイント変換 | ❌ 未実装 | Phase 5c で新規追加 |

### 1-3. 既存スクレイパー構造

```
HTTP GET https://whowatch.tv/events/{id} (公開ページ)
  │  User-Agent: TagDeck/0.1 (+https://tagtech.jp)
  │  Cookie: 不使用
  │  Timeout: 8秒
  ↓
parseRankingHtml()
  ├─ パターン1: <script id="embedded-data" data-props="..."> からJSONを抽出（優先）
  │    → data.rankings / data.event.rankings / data.entries を探索
  └─ パターン2: 正規表現 <tr data-rank="(\d+)"> でフォールバック
```

呼び出し間隔: **25秒以上**（`poll/route.ts` でタイムスタンプ比較）

### 1-4. 流用可能箇所 vs 新規実装必要箇所

| 箇所 | 流用 | 新規実装 |
|------|------|---------|
| `fetchEventRanking()` | ✅ ランキング取得に完全流用 | — |
| `extractRivals()` | ✅ 周辺ライバル抽出に流用 | — |
| `pollFuwacchiStreamerState()` | ✅ `total_point` 取得に流用 | — |
| 5秒ポーリング機構 | ✅ 同一パターン適用 | — |
| イベント一覧 API | — | ❌ 新規 (`/api/platforms/fuwacchi/events`) |
| カテゴリ別ランキング取得 | — | ❌ URL 形式確認後に実装 |
| アイテムマッピングテーブル | — | ❌ 新規 DB テーブル + 初期データ |
| EMA 補正層 | — | ❌ 新規ロジック |

---

## Task 2: ふわっちイベント一覧 API/スクレイピング調査

### 2-1. 確認された API エンドポイント群

```
# 公式 REST API (api.whowatch.tv) — ドキュメント非公開、動作報告あり
GET https://api.whowatch.tv/users/{userId}/lives_history?count=1  ← 既存実装済
GET https://api.whowatch.tv/lives/{liveId}                        ← 既存実装済
GET https://api.whowatch.tv/lives?order=new&category_id={id}      ← ライブ一覧 (非公式)
GET https://api.whowatch.tv/events                                 ← イベント一覧 (未確認、5c-β で実機確認要)
GET https://api.whowatch.tv/events/{eventId}                      ← イベント詳細 (未確認)
```

**重要**: `api.whowatch.tv` は公式ドキュメントなし。予告なき変更リスクあり。

### 2-2. HTML スクレイピング候補（API が使えない場合）

```
GET https://whowatch.tv/         ← トップページ（イベントバナー掲載あり）
GET https://whowatch.tv/events   ← イベント一覧ページ（URL 形式は推測、要確認）
```

パース方針:
1. `<script id="embedded-data" data-props="...">` から JSON 抽出（既存パターン流用）
2. `data.events` または `data.eventList` 配列を探索
3. 失敗時はユーザー手動 URL 入力にフォールバック

### 2-3. 取得すべきイベント情報

```typescript
interface FuwacchiEvent {
  eventId: string;
  name: string;            // "マンスリーイベント 2026年5月"
  startAt: string;         // ISO 8601
  endAt: string;
  categories: Array<{
    categoryId: string;
    name: string;          // "スコアランキング" / "ナイスランキング" 等
    rankingUrl: string;    // https://whowatch.tv/events/{id}/rankings/{catId}
  }>;
}
```

### 2-4. アイテム単価情報（既確認）

既存メモリ `reference_fuwacchi_pricing.md` より確定済み:

| 区分 | 代表アイテム | 単価 |
|------|-------------|------|
| イベント共通（8種） | ぶたさん / ゾウ / シカ / ワンちゃん他 | **160pt〜** |
| 倍率段階 | {1, 2, 3, 5, 10, 20, 33} | — |
| 最安アイテム | 音符/いいね/KP 等 | 50pt〜 |
| 通常アイテム | 草/神/かわいい等 | 90pt〜 |
| 大型アイテム | 花火系 | 1,100pt〜 |

公式ヘルプ URL:
- アイテム一覧: `https://help.whowatch.tv/アイテム-6149496e1e1fe1001f2bed2c`
- イベント共通アイテム: `https://help.whowatch.tv/イベント共通アイテム-661f23e69056270025d390bc`

### 2-5. 利用規約上の懸念

- ふわっち ToS に「自動クローリング禁止」の明示的条項は現時点で未確認だが、**非公式 API の利用は予告なき変更・ブロックリスク**がある
- 呼び出し間隔は **25秒以上** を厳守し、User-Agent を明示すること
- 大量リクエストはアカウント停止につながる可能性がある

---

## Task 3: ニコ生イベント一覧 API 調査

### 3-1. イベント種別分類

ニコ生のイベントは主に 3 種類:

| 種別 | 内容 | TagDeck 対象 |
|------|------|------------|
| 公式企画イベント | 運営主催のランキング系（月間/週間/特別） | ✅ 対象 |
| クリエイター奨励プログラム | 再生数・コメント数等による奨励ポイント | ❌ 対象外（配信中リアルタイム逆算不可）|
| コミュニティイベント | ユーザー主催 | ❌ 対象外 |

### 3-2. API の有無

**公式イベント API は廃止済み** (2022年11月24日 `live.nicovideo.jp/api/watchingreservation` 等削除)

存在が確認されている非公式エンドポイント:
```
GET https://live2.nicovideo.jp/api/v2/  ← タイムシフト予約系（イベント一覧には不向き）
```

イベント一覧の正式な確認先:
- `https://blog.nicovideo.jp/niconews/173156.html` (運営公式ブログ — URL は都度更新)
- `https://www.nicoevents.jp/` (イベント投稿サイト、非公式)

### 3-3. Phase 5c MVP の方針: ユーザー手動 URL 入力 + HTML スクレイピング

```
Phase 5c MVP:
  ① ユーザーがニコ生イベントランキングページのURLを手動でコピペ
     例: https://live.nicovideo.jp/ranking/
  ② TagDeck がHTMLをスクレイピングしてランキングを取得
  ③ 既存 extractRivals() 相当のロジックをニコ生HTML向けに新実装

Phase 5c+ (将来):
  API が復活した場合のみプルダウン化を再検討
```

### 3-4. ギフト→ポイント変換

**公式の詳細計算式は非公開**（工作防止・法令遵守のため）

確認できた情報:
- ニコニコポイント: 1pt = 1円で購入
- ギフト受け取り → クリエイター奨励スコアが加算
- 換金レート: **1,000スコア = 1円**（公式確認）
- 実質還元率: 投げ銭額の約 40%（非公式調査）

Phase 5c での対応方針:
- **ニコ生ギフト逆算機能は MVP 対象外**（計算式が非公開のため精度保証不可）
- Phase 5c のニコ生対応は「ランキング取得 + スコア差分逆算」に限定
- アイテム個数逆算はふわっち専用として実装

---

## Task 4: アイテム→ポイント変換（2 層構成）

### 4-A: 基準値層

#### ふわっち — 実装方針

**初期値**: 既確認の単価テーブルをハードコードで DB に投入（スクレイピング不要）

```typescript
// src/lib/platforms/fuwacchi-items.ts（Phase 5c-β で新規作成）
export const FUWACCHI_ITEM_TABLE = [
  // イベント共通アイテム（8種）
  { itemId: "event_buta",   name: "ぶたさん",     basePt: 160, isEventItem: true },
  { itemId: "event_zou",    name: "ゾウ",          basePt: 160, isEventItem: true },
  { itemId: "event_shika",  name: "シカさん",      basePt: 160, isEventItem: true, minLevel: 110 },
  { itemId: "event_wan",    name: "ワンちゃんさん", basePt: 160, isEventItem: true, minLevel: 120 },
  { itemId: "event_mogura", name: "もぐらさん",    basePt: 160, isEventItem: true },
  { itemId: "event_heroes", name: "スーパーヒーローズ2026", basePt: 160, isEventItem: true },
  { itemId: "event_ouen",   name: "ふわっち応援団",  basePt: 160, isEventItem: true },
  { itemId: "event_cinder", name: "シンデレラ",     basePt: 160, isEventItem: true },
  // 通常アイテム（代表）
  { itemId: "iine",        name: "いいね",          basePt: 50,  isEventItem: false },
  { itemId: "kp",          name: "KP",              basePt: 50,  isEventItem: false },
  { itemId: "hanabi_small",name: "花火",             basePt: 1100, isEventItem: false },
  // ... 全アイテム
] as const;

export const EVENT_MULTIPLIERS = [1, 2, 3, 5, 10, 20, 33] as const;
```

**更新方針**: 月1回、公式ヘルプページをスクレイピングして差分確認（CFO 定例レポートと連動）

#### ニコ生 — Phase 5c 対象外

上述の通り、公式計算式が非公開のためアイテム逆算は MVP スコープ外。

### 4-B: 補正層 — 推奨アルゴリズム

3 案の比較:

| 案 | 手法 | 複雑度 | 精度 | レイテンシ | 推奨 |
|---|------|--------|------|----------|------|
| **4-B-1** | 移動平均 (SMA) | 低 | 低（過去均等重み） | <1ms | — |
| **4-B-2** | 指数平滑移動平均 (EMA) | 低 | 中〜高（最近重視） | <1ms | **✅ 推奨** |
| **4-B-3** | 経験ベイズ (Phase 5b 流用) | 中 | 高（事前分布あり） | <5ms | — (将来) |

**推奨: 案 4-B-2 (EMA, α=0.3)**

推奨根拠:
- 補正係数は「配信中に実測したスコア増加 ÷ アイテム単価合計」という比であり、時系列で緩やかに変動する
- EMA は最近の観測に指数的に大きな重みを付けるため、配信中の倍率イベント（33倍 等）の影響を自然に薄められる
- SMA は全期間均等で変動への追従が遅い
- ベイズは补正係数そのものの事前分布推定が難しく過剰設計（Karpathy 原則 2 に反する）

```typescript
// EMA 更新式
// α = 0.3 (α が大きいほど最新データ重視)
corrFactor_new = α × observed_factor + (1 - α) × corrFactor_old

// observed_factor の計算
// 配信中に観測したスコア増加: Δscore（5秒間）
// 配信中にシステムが記録したアイテム投入値: Σ(basePt)（5秒間）
// observed_factor = Δscore / Σ(basePt)   ← これが実際の倍率効率
```

**EMA の初期値**: 1.0（補正なし、Phase 5a 互換）

### 4-C: 適用ロジック

```typescript
interface EffectivePtCalc {
  itemId: string;
  count: number;
}

function calcEffectivePt(
  items: EffectivePtCalc[],
  correctionFactor: number  // EMA 補正係数
): number {
  const basePt = items.reduce((sum, item) => {
    const entry = FUWACCHI_ITEM_TABLE.find(t => t.itemId === item.itemId);
    return sum + (entry?.basePt ?? 0) * item.count;
  }, 0);
  return basePt * correctionFactor;
}

// 実効ポイント = 公式基準値 × 補正係数
```

補正係数の妥当性チェック:
```typescript
// 許容範囲外は無視 (異常値フィルター)
const CORRECTION_MIN = 0.5;
const CORRECTION_MAX = 40.0;  // 33倍ガチャ上振れを考慮して余裕を持たせる
if (observed < CORRECTION_MIN || observed > CORRECTION_MAX) {
  // 無視 — EMA を更新しない
}
```

補正係数の更新タイミング:
- **配信中**: 5秒ごとのポーリング時に `PATCH /api/event-tracker/[id]/correction` を呼ぶ
- **配信終了時**: `POST /api/events/[id]/complete` のタイミングで最終係数を `item_point_correction` に保存

---

## Task 5: 4 種目標タイプ 逆算式

### 逆算の共通定義

```
effectivePtPerItem(itemId) = basePt(itemId) × corrFactor   [pt/個]
requiredItems(itemId)      = ⌈ requiredPt / effectivePtPerItem(itemId) ⌉  [個]
```

### (a) 順位達成 — 目標順位内に入るための必要ポイント

```
現在ライバルスコア取得: rivals = fetchRanking()[0..targetRank]
ライバル最低スコア:     thresholdScore = rivals[targetRank - 1].score
必要ポイント:           requiredPt = max(0, thresholdScore - myCurrentScore + BUFFER)
BUFFER = thresholdScore × 0.02  (2%の安全マージン)

必要アイテム数(itemId) = ⌈ requiredPt / effectivePtPerItem(itemId) ⌉
```

**Zod 入力スキーマ**:
```typescript
const GoalTypeAInput = z.object({
  goalType: z.literal("rank"),
  targetRank: z.number().int().min(1),
  myCurrentScore: z.number().int().min(0),
  rivalsSnapshot: z.array(z.object({ rank: z.number(), score: z.number() })),
  correctionFactor: z.number().min(0.5).max(40).default(1.0),
  targetItemId: z.string().optional(),
});
```

### (b) 絶対ポイント — 目標スコアまでの必要ポイント

```
必要ポイント: requiredPt = max(0, targetScore - myCurrentScore)
必要アイテム数(itemId) = ⌈ requiredPt / effectivePtPerItem(itemId) ⌉
```

**Zod 入力スキーマ**:
```typescript
const GoalTypeBInput = z.object({
  goalType: z.literal("absolute"),
  targetScore: z.number().int().min(1),
  myCurrentScore: z.number().int().min(0),
  correctionFactor: z.number().min(0.5).max(40).default(1.0),
  targetItemId: z.string().optional(),
});
```

### (c) ライバル差分克服 — リアルタイムライバルペースを考慮した逆算

```
ライバルペース推定: rivalPace = estimatePaceParameters(rival.scoreHistory).mean  [pt/h]
残り時間: remainingHours = (endTime - now) / 3600000
ライバル予測最終スコア: rivalFinalScore = rival.currentScore + rivalPace × remainingHours

必要ポイント: requiredPt = max(0, rivalFinalScore - myCurrentScore + BUFFER)
必要ペース(pt/h): requiredPace = requiredPt / remainingHours
必要アイテム/時(itemId) = ⌈ requiredPace / effectivePtPerItem(itemId) ⌉
```

**Zod 入力スキーマ**:
```typescript
const GoalTypeCInput = z.object({
  goalType: z.literal("rival_diff"),
  targetRival: z.object({
    currentScore: z.number().int(),
    scoreHistory: z.array(z.object({ timestamp: z.string(), score: z.number() })).min(2),
  }),
  myCurrentScore: z.number().int().min(0),
  endTime: z.string().datetime(),
  correctionFactor: z.number().min(0.5).max(40).default(1.0),
  targetItemId: z.string().optional(),
});
```

### (d) 残り時間でアイテム個数 — 時間あたりの必要投入数

```
現在ペース: myPace = estimatePaceParameters(myScoreHistory).mean  [pt/h]
必要ペース: requiredPace = requiredPt / remainingHours
追加で必要なペース: additionalPace = max(0, requiredPace - myPace)

必要アイテム/時(itemId) = ⌈ additionalPace / effectivePtPerItem(itemId) ⌉
必要アイテム合計(itemId) = ⌈ requiredPt / effectivePtPerItem(itemId) ⌉
```

**Zod 出力スキーマ（共通）**:
```typescript
const CalcResultSchema = z.object({
  requiredPt: z.number().int(),
  requiredPtPerHour: z.number(),
  items: z.array(z.object({
    itemId: z.string(),
    name: z.string(),
    basePt: z.number(),
    effectivePt: z.number(),
    countTotal: z.number().int(),
    countPerHour: z.number(),
  })),
  achievability: z.enum(["achievable", "tight", "difficult", "impossible"]),
  confidenceNote: z.string(),  // "補正係数 1.0 (データなし)" 等
  correctionFactor: z.number(),
  remainingHours: z.number(),
});
```

達成可能性判定:
```
remainingPt = myPace × remainingHours  (現在ペースで獲得できる推定ポイント)
ratio = remainingPt / requiredPt

ratio >= 1.2  → "achievable"  (余裕)
ratio >= 1.0  → "tight"       (ギリギリ)
ratio >= 0.7  → "difficult"   (厳しい)
ratio < 0.7   → "impossible"  (困難)
```

---

## Task 6: API 設計素案

### 6-1. 新規エンドポイント一覧

| メソッド | パス | 機能 | キャッシュ |
|---------|------|------|----------|
| GET | `/api/platforms/fuwacchi/events` | イベント一覧 | 10分 |
| GET | `/api/platforms/niconico/events` | イベント一覧（MVP: ユーザー URL 入力方式のため省略可） | — |
| GET | `/api/platforms/fuwacchi/events/[eventId]/ranking` | カテゴリ別ランキング | 25秒 |
| GET | `/api/platforms/niconico/events/[eventId]/ranking` | ランキング | 25秒 |
| GET | `/api/platforms/[platform]/items` | アイテム基準値マッピング | 24時間 |
| POST | `/api/event-tracker/calculate` | 逆算ロジック（4種対応） | なし |
| PATCH | `/api/event-tracker/[trackerId]/correction` | EMA 補正係数更新 | なし |
| POST | `/api/event-tracker` | トラッカー作成 | なし |
| GET | `/api/event-tracker` | トラッカー一覧 | なし |

### 6-2. GET /api/platforms/fuwacchi/events

```typescript
// 出力
const FuwacchiEventsResponseSchema = z.object({
  events: z.array(z.object({
    eventId: z.string(),
    name: z.string(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    categories: z.array(z.object({
      categoryId: z.string(),
      name: z.string(),
      rankingUrl: z.string().url(),
    })),
  })),
  source: z.enum(["api", "html_scrape", "manual"]),
  fetchedAt: z.string().datetime(),
});
```

**実装方針**:
1. `GET https://api.whowatch.tv/events` を試行（5c-β で実機確認後確定）
2. 失敗時 → `https://whowatch.tv/` の embedded-data からイベント一覧を抽出
3. 全失敗時 → `source: "manual"` を返し、フロントでユーザーに URL 入力を促す

### 6-3. GET /api/platforms/[platform]/items

```typescript
// 入力クエリ
const ItemsQuerySchema = z.object({
  platform: z.enum(["fuwacchi", "niconico"]),
  eventOnly: z.boolean().default(false),  // イベント共通アイテムのみ
});

// 出力
const ItemsResponseSchema = z.object({
  items: z.array(z.object({
    itemId: z.string(),
    name: z.string(),
    basePt: z.number().int(),
    isEventItem: z.boolean(),
    minLevel: z.number().int().optional(),
  })),
  multipliers: z.array(z.number()).optional(),  // ふわっちのみ: [1,2,3,5,10,20,33]
  lastUpdatedAt: z.string().datetime(),
});
```

Cache-Control: `public, max-age=86400`（24時間）

### 6-4. POST /api/event-tracker/calculate

```typescript
// 入力
const CalculateInputSchema = z.discriminatedUnion("goalType", [
  GoalTypeAInput,
  GoalTypeBInput,
  GoalTypeCInput,
  GoalTypeDInput,  // (d) は (c) の派生として実装
]).extend({
  platform: z.enum(["fuwacchi", "niconico"]),
  remainingHours: z.number().positive(),
  targetItemIds: z.array(z.string()).default(["event_buta"]),  // 計算対象アイテム
});

// 出力
const CalculateOutputSchema = CalcResultSchema;
```

レスポンス時間目標: **<50ms**（純粋な計算、DB アクセスなし）

### 6-5. PATCH /api/event-tracker/[trackerId]/correction

```typescript
// 入力
const CorrectionUpdateSchema = z.object({
  observedDeltaScore: z.number().int().min(0),  // 5秒間のスコア増加
  observedItemBasePt: z.number().int().min(0),  // 5秒間のアイテム基準値合計
});

// 出力
{ correctionFactor: number, sampleCount: number }
```

### 6-6. ポーリング実装方針

```typescript
// src/hooks/useEventTracker.ts（新規）
useQuery({
  queryKey: ["event-tracker", trackerId],
  queryFn: () => fetchCalculation(trackerId),
  refetchInterval: 5000,  // 5秒
  staleTime: 4000,
})
```

### 6-7. レート制限対策

| リクエスト先 | 間隔 | 実装箇所 |
|------------|------|---------|
| `whowatch.tv` HTML | 25秒以上 | `poll/route.ts` の timestamp 比較（既存流用） |
| `api.whowatch.tv` | 5秒以上 | 既存ポーリング機構（既存流用） |
| `live.nicovideo.jp` | 30秒以上 | 新規実装（timestamp 比較） |
| アイテム一覧 | 24時間ごと | `Cache-Control` ヘッダー |

---

## Task 7: DB スキーマ追加素案

### 7-A: event_trackers テーブル新設

```typescript
// Drizzle スキーマ素案
export const eventTrackers = pgTable("event_trackers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),

  platform: text("platform").notNull(),  // 'fuwacchi' | 'niconico'
  eventId: text("event_id"),             // プラットフォーム固有のイベントID
  eventName: text("event_name"),
  categoryId: text("category_id"),
  categoryName: text("category_name"),
  rankingUrl: text("ranking_url"),

  // 目標設定
  goalType: text("goal_type").notNull(),  // 'rank' | 'absolute' | 'rival_diff' | 'item_rate'
  goalValue: jsonb("goal_value").notNull(),  // goal_type 別の構造

  // 現在の補正係数（EMA）
  correctionFactor: real("correction_factor").default(1.0).notNull(),
  correctionSampleCount: integer("correction_sample_count").default(0).notNull(),
  lastCorrectionAt: timestamp("last_correction_at"),

  status: text("status").notNull().default("active"),  // 'active' | 'completed'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
```

### 7-B: item_point_mapping テーブル新設（基準値層）

```typescript
export const itemPointMapping = pgTable("item_point_mapping", {
  id: uuid("id").primaryKey().defaultRandom(),
  platform: text("platform").notNull(),   // 'fuwacchi' | 'niconico'
  itemId: text("item_id").notNull(),
  itemName: text("item_name").notNull(),
  basePt: integer("base_pt").notNull(),
  isEventItem: boolean("is_event_item").default(false).notNull(),
  minLevel: integer("min_level"),         // ふわっちのレベル制限
  lastFetchedAt: timestamp("last_fetched_at").defaultNow().notNull(),
});
```

**全ユーザー共有**:
- 読み取り: `public` ロール OK（RLS なし、公開データ）
- 書き込み: `service_role` のみ（管理者バッチのみ更新可）

### 7-C: item_point_correction テーブル新設（補正層）

```typescript
export const itemPointCorrection = pgTable("item_point_correction", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id).notNull(),
  trackerId: uuid("tracker_id").references(() => eventTrackers.id).notNull(),

  correctionFactor: real("correction_factor").default(1.0).notNull(),
  sampleCount: integer("sample_count").default(0).notNull(),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
});
```

### 7-D: RLS Policy 素案（Phase 5 同パターン）

```sql
-- event_trackers
ALTER TABLE event_trackers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own trackers"
  ON event_trackers FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- item_point_correction
ALTER TABLE item_point_correction ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own corrections"
  ON item_point_correction FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- item_point_mapping (全ユーザー読み取り可)
ALTER TABLE item_point_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read item mappings"
  ON item_point_mapping FOR SELECT
  USING (true);
```

**重要**: Drizzle は `postgres` ロール（BYPASSRLS）で動作するため、全 SQL に `user_id` 条件を明示する。

### 7-E: 既存 event_simulators との関係

`event_trackers` は `event_simulators` と**完全独立**の新テーブル。外部キー参照なし。
理由: Phase 5c 目標トラッカーは配信中でも単独動作させるため（イベント作成不要で即使用できる）。

---

## Task 8: UI 統合方針

### 8-1. タブ構成

```
/events ページ
└─ shadcn/ui <Tabs>
   ├─ <TabsTrigger value="simulator">📊 シミュレーター</TabsTrigger>  ← 既存 EventDashboard
   └─ <TabsTrigger value="tracker">🎯 目標トラッカー</TabsTrigger>   ← 新規 EventTracker
```

変更箇所: `src/app/(dashboard)/events/page.tsx` にタブラッパーを追加（既存コンポーネントは無変更）

### 8-2. プルダウン UI フロー（新規コンポーネント）

```
EventTrackerTab.tsx (新規)
  │
  Step 1: プラットフォーム選択
  │   <Select> → "ふわっち" | "ニコ生"
  │
  Step 2: イベント選択
  │   GET /api/platforms/{platform}/events → プルダウン
  │   ※失敗時 → テキスト入力（URL 手動入力）にフォールバック
  │
  Step 3: カテゴリ選択（ふわっちのみ）
  │   イベント選択後、そのイベントのカテゴリ一覧を表示
  │
  Step 4: 目標タイプ選択
  │   <RadioGroup>
  │   ├─ (a) 目標順位以内に入る
  │   ├─ (b) 合計 N ポイント達成
  │   ├─ (c) 特定ライバルに追いつく
  │   └─ (d) 残り時間で最大アイテム数を計算
  │
  Step 5: 目標値入力（タイプ依存）
  │   (a) → 目標順位（数値）
  │   (b) → 目標ポイント（数値）
  │   (c) → ライバル名（テキスト）
  │   (d) → 投入予定アイテム種別 × 個数
  │
  結果表示エリア (5秒ごと自動更新)
  ├─ 必要ポイント
  ├─ アイテム種別別の必要個数（選択アイテムのみ）
  ├─ 達成可能性バッジ (achievable / tight / difficult / impossible)
  ├─ 補正係数表示: "📈 補正係数 1.23（実測 47回）"
  └─ 残り時間
```

### 8-3. Phase 5b バッジとの共存

- 「シミュレーター」タブ側: 既存 Phase 5b バッジ（📊 過去データ参照中）はそのまま残す
- 「目標トラッカー」タブ側: 補正係数の独自表示
- タブ切替時に両方のポーリングは維持（`enabled: isActiveTab` で制御）

### 8-4. コンポーネント構成（新規ファイルのみ）

```
src/components/events/
  ├─ EventTrackerTab.tsx   ← メインコンポーネント（ステップ UI）
  ├─ TrackerResult.tsx     ← 結果表示エリア
  └─ ItemSelector.tsx      ← アイテム種別選択（チェックボックス）

src/hooks/
  └─ useEventTracker.ts    ← TanStack Query refetchInterval:5000

src/app/api/event-tracker/
  ├─ route.ts              ← POST (作成) / GET (一覧)
  └─ [trackerId]/
      ├─ correction/route.ts  ← PATCH
      └─ calculate/route.ts   ← POST (or GET)

src/lib/platforms/
  └─ fuwacchi-items.ts     ← アイテムマッピングテーブル（定数）
```

---

## Task 9: 設計書作成結果

**ファイルパス**: `D:\tagdeck\docs\architecture\phase5c-event-tracker-design.md`  
**バージョン**: v1.0（実装前）  
**規模**: 約 350 行

---

## 推奨される Phase 5c-β 以降の進め方

### フェーズ分割と所要時間見積もり

| フェーズ | 内容 | 見積 |
|--------|------|------|
| **5c-α** | 設計書作成（本ドキュメント） | 完了 |
| **5c-β** | ふわっちイベント API 実機確認 + アイテムマッピング DB + `/api/platforms/fuwacchi/events` | 2〜3h |
| **5c-γ** | 4種逆算ロジック (`calculate` API) + vitest 単体テスト | 3〜4h |
| **5c-δ** | EMA 補正層 (`correction` API + フック) | 2〜3h |
| **5c-ε** | UI 実装（EventTrackerTab + 5秒ポーリング表示） | 4〜6h |
| **5c-ζ** | ニコ生ランキング取得 + DB マイグレーション + RLS SQL | 3〜4h |
| **5c-η** | 統合テスト + 本番デプロイ | 2〜3h |

**合計見積**: 16〜23 時間（実機確認次第で変動）

### 優先実施順（MVP 最速ルート）

```
5c-β（アイテムDB） → 5c-γ（逆算ロジック） → 5c-ε（UI）→ デプロイ
                                                ↑ ここで一度リリース可能
5c-δ（EMA）→ 5c-ζ（ニコ生）→ 5c-η → 完全版デプロイ
```

---

## リスク登録

| # | リスク | 重大度 | 対策 |
|---|------|--------|------|
| R1 | **ふわっち非公式 API 廃止/変更** | 高 | HTML スクレイピングへのフォールバック実装を必須とする |
| R2 | **利用規約上のスクレイピング懸念** | 中 | 25秒以上の間隔厳守 + User-Agent 明示 + 過剰アクセス禁止。ToS に明示的禁止があれば即停止 |
| R3 | **5秒ポーリングのサーバー負荷** | 中 | TanStack Query `staleTime=4000` + キャッシュ設計でリクエスト集約。アクティブタブのみ有効化 |
| R4 | **補正係数の異常値** | 低〜中 | 許容範囲 0.5〜40.0 で除外、EMA なのでスパイクは薄まる |
| R5 | **ふわっち倍率仕様変更** | 中 | 月1回 CFO 定例で確認（既存ルール維持）。変更検知時は `item_point_mapping` 更新 |
| R6 | **ニコ生 API 復活時の対応コスト** | 低 | Phase 5c MVP はスクレイピングで割り切る。API 復活時は `source: "api"` 実装で対応 |
| R7 | **既存 Phase 5a/5b への影響** | 低 | 独立テーブル・独立コンポーネントで完全分離。`monte-carlo.ts` / `bayesian.ts` 無変更 |

---

## 社長承認待ち項目

| # | 項目 | 選択肢 | 推奨 |
|---|------|--------|------|
| 1 | **ニコ生対応の MVP スコープ** | A: ランキング取得のみ（MVP）/ B: ギフト逆算も含む | **A 推奨**（計算式非公開のため B は精度保証不可） |
| 2 | **ふわっちイベント選択方式** | A: API プルダウン（5c-β 実機確認後） / B: 当面は URL 手動入力 | **A を試みて失敗時に B** |
| 3 | **EMA α 値** | 0.2（安定）/ 0.3（標準）/ 0.5（高速追従） | **0.3 推奨** |
| 4 | **アイテム逆算の対象アイテム数** | A: 全アイテム（30〜40種）/ B: イベント共通 8 種のみ / C: ユーザー選択 | **C 推奨**（ユーザーが投入するアイテムを選べるUIが最も実用的）|
| 5 | **Phase 5c-ζ（ニコ生）の着手タイミング** | 5c-ε と並行 / 5c-ε 完了後 | 5c-ε 完了後に開始 |
| 6 | **利用規約リスクの許容** | スクレイピングを進める / ふわっちに問い合わせてから進める | 社長判断 |

---

## 既存 Phase 5a/5b との関係性

| Phase | 機能 | 今回の変更 |
|-------|------|----------|
| 5a モンテカルロ | `monte-carlo.ts` + `calculator.ts` | **無変更** |
| 5b 経験ベイズ | `bayesian.ts` + `historical-pace` API | **無変更**（将来 4-B-3 採用時に流用候補） |
| 5c 目標トラッカー | 新規（独立実装） | 本ドキュメント対象 |

*設計書 v1.0 — Phase 5c-β 開始前に社長承認を得ること*

---

## Phase 5c-β 実装履歴

- **2026-05-09 完了**: ふわっちイベント API 実機確認 + アイテムマッピング DB + 2 エンドポイント
- **採用エンドポイント**: `source: "manual"` (第一候補 api.whowatch.tv/events → 404、第二候補 whowatch.tv/events → SPA で embedded-data なし)
- **User-Agent**: `TagDeck/0.1 (+https://tagdeck.jp)` に統一 (CLAUDE.md ブランド規約遵守)
- **新規ファイル一覧**:
  - `src/lib/db/schema.ts` — itemPointMapping テーブル定義追加
  - `src/lib/platforms/fuwacchi/item-mapping.ts` — 8 種アイテム定数 + FUWACCHI_MULTIPLIERS
  - `src/lib/platforms/fuwacchi/event-list.ts` — fetchFuwacchiEvents() フォールバックチェーン実装
  - `src/lib/platforms/fuwacchi/event-list.test.ts` — vitest 6 件
  - `src/lib/platforms/fuwacchi/item-mapping.test.ts` — vitest 8 件
  - `src/app/api/platforms/fuwacchi/events/route.ts` — GET /api/platforms/fuwacchi/events
  - `src/app/api/platforms/fuwacchi/items/route.ts` — GET /api/platforms/fuwacchi/items
  - `supabase_phase5c_item_mapping.sql` — CREATE TABLE + RLS + INSERT (8 件) + ON CONFLICT 冪等化
  - `supabase_phase5c_item_mapping_rollback.sql` — ロールバック SQL
  - `docs/legal/scraping-compliance-2026-05-09.md` — v1.1: User-Agent 文言修正 + 改訂履歴追加
- **既存ファイル無変更**: git diff で monte-carlo.ts / calculator.ts / bayesian.ts / EventDashboard.tsx 差分ゼロ確認済
- **vitest**: 22 件 PASS (新規 14 件 + 既存 bayesian 8 件)

---

## Phase 5c-β 拡張実装履歴

- **2026-05-09 完了**: HAR 解析で実 API エンドポイント確認 → n8n daily sync + 拡張スキーマ実装
- **HAR 確認エンドポイント**:
  - `GET api.whowatch.tv/playitems/payments3` (アイテム一覧 ~430 KB)
  - `GET api.whowatch.tv/event_lists` (イベント一覧 ~1.8 KB)
  - 認証: `x-whowatch-device-id` ヘッダーのみ (Cookie 不要)
- **倍率修正**: {1, 2, 3, 5, 10, 20, 33} → {1, 2, 20, 33} (HAR 実測値で 3/5/10 は誤情報と判明)
- **API エンドポイント修正**: `FUWACCHI_ALLOWED_URLS[0]` を `/events` → `/event_lists` に変更
- **新規ファイル一覧**:
  - `src/lib/db/schema.ts` — itemPointMapping 拡張カラム + fuwacchi_events テーブル追加
  - `src/lib/platforms/fuwacchi/item-mapping.ts` — 7 件 (HAR 確認済み) + FUWACCHI_MULTIPLIERS=[1,2,20,33]
  - `supabase_phase5c_extension.sql` — ALTER TABLE + CREATE TABLE fuwacchi_events
  - `supabase_phase5c_item_mapping.sql` — 7 件 INSERT 更新 (product_id / whowatch_id 追加)
  - `scripts/platforms/fuwacchi/sync_items_and_events.py` — Python 同期スクリプト (urllib only, 30s/1retry)
  - `scripts/platforms/fuwacchi/test_sync_items_and_events.py` — pytest 15 件
  - `scripts/platforms/fuwacchi/pytest.ini` — `*.test.py` 除外、`test_*.py` 標準パターン
  - `data/n8n_workflows/tagdeck_fuwacchi_sync_daily.json` — n8n Cron(UTC 15:00) + Code(JS spawn) + IF + Discord×2
  - `docs/architecture/fuwacchi_api_endpoints_v1.md` — HAR 確認済みエンドポイント仕様
  - `docs/features/fuwacchi_sync_daily_ops_v1.md` — 運用ガイド (device-id 更新手順含む)
- **修正ファイル**:
  - `src/lib/platforms/fuwacchi/event-list.ts` — API URL + device-id ヘッダー対応
  - `src/lib/platforms/fuwacchi/event-list.test.ts` — 7 件 (device-id なし / ホワイトリスト検証 追加)
  - `src/lib/platforms/fuwacchi/item-mapping.test.ts` — 7 件アイテム + FUWACCHI_MULTIPLIERS=[1,2,20,33]
  - `src/app/api/platforms/fuwacchi/events/route.ts` — DB-first (fuwacchi_events) → スクレイパーフォールバック
  - `docs/legal/scraping-compliance-2026-05-09.md` — tagtech.jp → tagdeck.jp User-Agent 修正
- **テスト結果**:
  - vitest: 25 件 PASS (3 ファイル)
  - pytest: 15 件 PASS
  - tsc --noEmit: エラーなし
