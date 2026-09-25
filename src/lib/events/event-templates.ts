// イベント型テンプレート（R1）。
// whowatch はイベント詳細ルールを機械取得できない(event-title.tsのヘッダーコメント参照)ため、
// 「どの型がどんなルール/単位/倍率か」はこのファイルに社長監修の静的データとして持つ。
// DBテーブルではなくコード定数（schema変更なし）。ceoConfirmedAt が null のテンプレは
// 全出力に(要確認)を強制する前提で、利用側(strategy.ts 等)は必ずこのフラグを見ること。

export type EventGoalType = "score" | "ranking" | "nice" | "viewer";

export interface EventTypeTemplate {
  typeKey: string;
  label: string;
  /** 正規化slug(normalizeEventKeySlug後)への前方一致パターン */
  matchPatterns: string[];
  goalTypes: EventGoalType[];
  /** (要確認) ランキングAPIから機械抽出不可のため社長のドメイン知識が必須 */
  unit: string;
  /** (要確認) このイベントで有効な倍率 [1,2,20,33] の部分集合 */
  availableMultipliers: number[];
  /** (要確認) 効率ソート用の代表倍率 */
  defaultMultiplier: number;
  /** (要確認) itemId → 固定倍率の上書き（例: ouen_wanchan は 33 倍専用） */
  itemMultipliers?: Record<string, number>;
  /** (要確認) カード/聖杯等ブースト仕様の要約 */
  boostSpec?: string;
  /** (要確認) 推奨投げタイミングの要約 */
  recommendTiming?: string;
  /** (要確認) ルール概要 */
  ruleSummary: string;
  /** null = 未監修。社長確認済みになったら日付(ISO)を入れる運用 */
  ceoConfirmedAt: string | null;
}

/**
 * event_key から先頭の YYYY_MM_ 日付プレフィックスを剥がした正規化slugを返す。
 * 例: "2026_07_whowatchgrandprix" → "whowatchgrandprix"
 *     "2026_07_weekend_4"         → "weekend_4"
 * 日付プレフィックスが無ければそのまま返す。
 */
export function normalizeEventKeySlug(eventKey: string): string {
  const dated = eventKey.match(/^\d{4}_\d{1,2}_(.+)$/);
  return dated ? dated[1] : eventKey;
}

// 2026-07-24 event_lists 実データ(規約適合・単発取得)から分類したドラフト。
// 全項目が未監修(ceoConfirmedAt:null)。typeKey/matchPatterns/実キー例以外は(要確認)。
export const EVENT_TEMPLATES: EventTypeTemplate[] = [
  {
    typeKey: "wgp",
    label: "WGP（ふわっちグランプリ）",
    matchPatterns: ["whowatchgrandprix"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20, 33], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "大型/看板イベント（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "monthly",
    label: "マンスリー",
    matchPatterns: ["monthly"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "定期開催（月次）イベント（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "vstar",
    label: "Vスター",
    matchPatterns: ["vstar"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "定期開催（月次）イベント（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "weekend",
    label: "ウィークエンド",
    matchPatterns: ["weekend"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "週末開催の短期（2日程度）イベント（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "stepup",
    label: "ステップアップ",
    matchPatterns: ["stepup"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "定期開催イベント（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "rookie",
    label: "ルーキー",
    matchPatterns: ["rookie"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "新人・低層向け定期イベント（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "wwboss",
    label: "WWボス",
    matchPatterns: ["wwboss"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "定期開催イベント（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "gold_digger",
    label: "ゴールドディガー",
    matchPatterns: ["gold_digger"],
    goalTypes: ["ranking"],
    unit: "重さ/個", // (要確認) 名称からの推測。pt の可能性もあり
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "テーマ/採掘系イベント（要確認・ルール未監修・単位が特殊な可能性）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "samba",
    label: "サンバカーニバル",
    matchPatterns: ["samba_carnival", "samba"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "テーマ/季節イベント（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "calendar",
    label: "カレンダー",
    matchPatterns: ["calendar"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "テーマ/年間イベント（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "morineko",
    label: "もりねこ系",
    matchPatterns: ["morinekobread", "morineko"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "テーマイベント（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "team_battle",
    label: "チーム対抗",
    matchPatterns: ["legendteamers", "team_battle"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "チーム戦形式イベント（要確認・ルール未監修・個人ランキングと異なる可能性）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "dojo",
    label: "ふわっち道場",
    matchPatterns: ["whowatch_dojo"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "常設ランキング（要確認・ルール未監修・期間区切りが無い可能性）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "nice_ranking",
    label: "ナイスランキング",
    matchPatterns: ["nice_one_ranking"],
    goalTypes: ["nice"],
    unit: "いいね", // (要確認)
    availableMultipliers: [1], // (要確認) いいね数は投げアイテム倍率と無関係の可能性
    defaultMultiplier: 1, // (要確認)
    ruleSummary: "常設のいいね数ランキング（要確認・ルール未監修）",
    ceoConfirmedAt: null,
  },
  {
    typeKey: "pubsup",
    label: "配信者サポート系",
    matchPatterns: ["pubsup"],
    goalTypes: ["ranking"],
    unit: "pt", // (要確認)
    availableMultipliers: [1, 2, 20], // (要確認)
    defaultMultiplier: 2, // (要確認)
    ruleSummary: "定期開催イベント（要確認・略称の正式名称も未確認）",
    ceoConfirmedAt: null,
  },
];

export const DEFAULT_EVENT_TEMPLATE: EventTypeTemplate = {
  typeKey: "default",
  label: "汎用イベント",
  matchPatterns: [],
  goalTypes: ["score", "ranking", "nice", "viewer"],
  unit: "pt", // (要確認)
  availableMultipliers: [1, 2, 20, 33], // (要確認)
  defaultMultiplier: 1, // (要確認) 未分類のため保守的に等倍を既定とする
  ruleSummary: "未分類イベント（型テンプレ未整備のため一般化した既定値を使用）",
  ceoConfirmedAt: null,
};

/**
 * event_key に対応するイベント型テンプレートを返す。
 * 日付プレフィックスを剥がした正規化slugが matchPatterns のいずれかに前方一致すればヒット。
 * ヒットしなければ DEFAULT_EVENT_TEMPLATE を返す（未分類でも安全に動作させるため）。
 */
export function matchEventTemplate(eventKey: string): EventTypeTemplate {
  if (!eventKey) return DEFAULT_EVENT_TEMPLATE;
  const slug = normalizeEventKeySlug(eventKey);
  const hit = EVENT_TEMPLATES.find((t) =>
    t.matchPatterns.some((pattern) => slug === pattern || slug.startsWith(pattern))
  );
  return hit ?? DEFAULT_EVENT_TEMPLATE;
}
