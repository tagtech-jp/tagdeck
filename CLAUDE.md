# TagDeck CLAUDE.md

このファイルは Claude（claude.ai および Claude Code）への文脈情報です。AGENTS.md と併読してください。

作業開始前に `D:/tagdeck/CODEX_CLAUDE.md` も読んでください。Codex と Claude Code の並行作業、MCP、承認境界、検証コマンドは同ファイルを参照します。

## 運営者について

- TagTech 運営者（個人事業主、株式会社化準備中）
- ADHD・ASD・双極性障害・糖尿病あり
- 強み：過集中・こだわり・行動力
- 弱み：タスク管理・優先順位・マルチタスク
- AI でカバーすべき領域：組織化・優先順位付け・進捗管理

## 応答ルール

- 日本語で回答
- 結論を最初に、続けて箇条書き要約
- 専門用語には日本語の説明併記
- 不必要な謝罪・前置きは省く
- 横文字には日本語の説明を必ず併記

## TagDeck の位置付け

TagTech の第 7 事業として位置付け（既存 6 事業に追加）。担当は CPO（PF 開発本部）と CSO（事業検証）。

メイン事業化判断は半年後の以下指標で行う：
- DAU（デイリーアクティブユーザー）
- 有料転換率
- 解約率
- 月商 30 万円ライン

## 関連プロジェクト

- 裏キック団（urakick.vercel.app）：D:\urakick に存在、別プロジェクトなので混同しない
- erupi v9：C:\erupi_system に存在、Bloomberg 風配信システム
- watcher.py：運営者個人の配信用ツール（ふわっち API ポーリング）。TagDeck には組み込まない（個人利用と商用提供は別物）

## 品質ゲート（2026-09-23〜）

- GitHub Actions を使わない運用のため、**ローカル3点（`pnpm exec tsc --noEmit` / `pnpm test` / `pnpm exec next build --webpack`）が唯一の品質ゲート**。このリポジトリは private + Free でブランチ保護を設定できず、CI が赤でもマージできてしまうため、人間の目視が最後の砦になる
- PR 報告時は3点すべての結果を明示すること。1つでも赤なら報告に「赤」と書き、マージを求めない

## migration の再提示（2026-09-23 の実害から）

- **列を足して SQL を提示し直すときは、`CREATE TABLE IF NOT EXISTS` だけで済ませない。** 既存テーブルには列が追加されないため、社長が実行しても「Success」が返るのに何も起きない
- 提示し直す SQL には `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` を必ず併記する
- `_manual` SQL の末尾には、**コメントアウトしない確認 SELECT**（`information_schema.columns` の列一覧）を置き、期待する行数を書き添える
- 実害: 0016 を 5 列版で適用済みの DB に 8 列版を流して無反応となり、`/items/patterns` が HTTP 500・カテゴリ 0 件になった。原因究明に数往復を要した

## デザインルール（DESIGN.md）

- UI・Webページを実装・修正するときは、必ず同ディレクトリの `DESIGN.md` を最初に読み、そこで定義されたデザイントークンに従うこと
- 従う対象：カラー、タイポグラフィ（フォント・サイズ・ウェイト・行間・字間）、spacing スケール、border-radius、shadow、レイアウト（max-width / section gap / card padding）
- DESIGN.md に定義が無い色・radius・shadow・フォントを新たに発明しないこと。必要な場合は実装前に確認を取る
- DESIGN.md の「Do / Don't」セクションは必ず守ること
- ブランド固有の要素（ロゴ、プロダクト名、アクセントカラーの意味づけ）はそのまま流用せず、本プロジェクトのブランドに置き換えること
- マスターは `D:\tagtech\DESIGN.md`。本ファイルはその複製であり、直接編集せずマスターを更新して同期すること

## tagdeck-live / tagdeck-event 開発サイクル（サブエージェント）

このワークツリー（`D:\tagtech\projects\tagdeck-live-cockpit`）専用のサブエージェントを `.claude/agents/` に定義済み:

- **whowatch-verifier**（検証・PR前ゲート、読み取り専用）: ビルド・Route export 制約・X-Sync-Key ルート登録漏れ・migration 整合性・Workers サブリクエスト上限・秘密のログ出力・表記ルール・Actions workflow を機械検査し、PASS/FAIL 表と「PR 可/不可」を返す
- **whowatch-api-checker**（裏取り、読み取り専用・GET のみ）: ふわっち公開 API の実応答を確認し、`D:\tagtech\docs\streaming\remote-studio-plan.md` との差分を報告する
- **docs-keeper**（文書・台帳更新）: Phase 完了時に README/TODO.md/docs/live-cockpit/*.md・正本の到達点節・Notion タスク管理（`[tagdeck-live]`/`[tagdeck-event]`/`[whowatch-feed]`）を更新する

### 運用フロー

1. 実装（メインセッション）
2. **PR を出す前に必ず whowatch-verifier を通す**。FAIL があれば直してから 3 へ進む
3. PR 作成・CI 緑を確認
4. 「CI 緑・止まります」と社長へ報告し、マージを待つ
5. 社長マージ後、docs-keeper で文書・Notion を更新する

API の仕様に触れる変更（新エンドポイント・新フィールド・既存フィールドの解釈変更）を伴う場合は、実装前に whowatch-api-checker を 1 回走らせて裏取りしてから着手する。

サブエージェントは同じワークツリー内で並列にファイルを書き込まない。書き込みは docs-keeper とメインセッションのみ。verifier と api-checker は読み取り専用。
