// X-Sync-Key で保護される「サーバ間呼び出し専用」ルートの単一の定義元。
//
// 過去の教訓（PR #17 → ranking/sync、そして本件 → items/sync）: middleware.ts の
// 素通し設定を「AUTH_BYPASS_PATHS 配列」と「matcher の除外正規表現」の 2 か所に手で
// 書いていたため、新しい同期ルートを追加するたびにどちらかを更新し忘れ、本番で
// HTTP 307（/login へのリダイレクト）が繰り返し発生した。
//
// 対策: この配列だけが唯一の定義元。
//   - middleware.ts は isSyncRoutePath() でこの配列を参照して素通しする
//     （matcher 自体はもう個別ルートを列挙しない。matcher が拾わなくても
//     このランタイムチェックが必ず先に効く設計にして、更新箇所を 1 か所に減らした）
//   - 各ルート（rankings/sync, events/sync, items/sync）は自分の path を
//     SYNC_ROUTES から検索し、そこで定義された envKey を使って X-Sync-Key を検証する。
//     もし自分の path が配列に無ければ 500 を返す（登録漏れを黙って通さない）
//   - src/lib/sync-routes.test.ts が全ルートをループしてループ検証する
//
// 新しい同期ルートを追加するときは、ここに 1 行足すだけでよい。

export interface SyncRouteDef {
  /** リテラル・完全一致のパス。動的セグメントは対象外 */
  path: `/api/${string}`;
  /** X-Sync-Key と比較する環境変数名。現状は全ルート共通だが将来分けられるようにしている */
  envKey: "RANKING_SYNC_KEY";
  /** verifier・ドキュメント用の一言説明 */
  description: string;
}

export const SYNC_ROUTES: readonly SyncRouteDef[] = [
  { path: "/api/platforms/whowatch/rankings/sync", envKey: "RANKING_SYNC_KEY", description: "E2: 開催中シミュレーターのランキングを 5 分毎に同期" },
  { path: "/api/platforms/whowatch/events/sync", envKey: "RANKING_SYNC_KEY", description: "E1/E1b: open/pre イベントの詳細(区分・periods・ルール)を同期" },
  { path: "/api/platforms/whowatch/items/sync", envKey: "RANKING_SYNC_KEY", description: "S1: /playitems のアイテムパターンを同期" },
] as const;

export const SYNC_ROUTE_PATHS: readonly string[] = SYNC_ROUTES.map((r) => r.path);

export function isSyncRoutePath(pathname: string): boolean {
  return SYNC_ROUTE_PATHS.includes(pathname);
}

export function findSyncRoute(path: string): SyncRouteDef | undefined {
  return SYNC_ROUTES.find((r) => r.path === path);
}
