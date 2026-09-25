// ふわっちイベント応援アイテム (HAR 解析確定値 / 2026-05)
// DB 同期後は supabase から取得するため、このファイルは DB 失敗時のフォールバック専用
export const WHOWATCH_ITEMS = [
  { id: "ouen_pig",     name: "トンでもない応援をするぶたさん",            basePoint: 160 },
  { id: "ouen_zou",     name: "イベント応援するゾウ!",                     basePoint: 160 },
  { id: "ouen_deer",    name: "たしかな応援をするシカさん",                basePoint: 160 },
  { id: "ouen_wanchan", name: "ワンチャン33倍の応援をするワンちゃんさん", basePoint: 160 },
  { id: "ouen_mogura",  name: "もぐりながら応援するもぐらさん",            basePoint: 160 },
  { id: "weekend_1",    name: "シンデレラ",                                basePoint: 160 },
  { id: "baseball2026", name: "ピッチャーもりあげねこさん",                basePoint: 160 },
] as const;

// ふわっちアイテム倍率段階 (HAR の play_item_description 確認値)
// 通常イベント: 2倍/20倍、ワンちゃんさん専用: 33倍
// 旧 {1,2,3,5,10,20,33} は誤情報のため削除済み
export const WHOWATCH_MULTIPLIERS = [1, 2, 20, 33] as const;

export type WhowatchItem = (typeof WHOWATCH_ITEMS)[number];
