# TagDeck AGENTS.md

このファイルは Claude Code・GitHub Copilot 等の AI コーディングエージェントへの指示書です。

## Codex / Claude 共通運用

作業開始前に `D:/tagdeck/CODEX_CLAUDE.md` も読むこと。Codex と Claude Code の並行作業、MCP、承認境界、検証コマンドは同ファイルを優先する。

## プロジェクト概要

TagDeck は配信者向けセカンドスクリーン SaaS です。ふわっち・ニコ生・Kick の配信者が、配信中にサブ端末でリスナー CRM・AI 接客カンペ・イベント勝率シミュレーターを参照するために使います。

## 必ず守る制約

### 法務（最重要）

- ふわっちは公開 API（api.whowatch.tv/lives2 等）のポーリング（ライブ配信は5秒 / ランキング取得は300秒以上）
- **決裁（2026-09-25・社長）**: SE のラグ解消のため、`/lives/{id}` 応答に含まれる `comment_server_url` / `jwt` を使ったコメントサーバ（WebSocket）への接続を **例外として許可** する。範囲は「ふわっち Web 版が使う接続先へ、本人の配信について、本人のブラウザから、受信のみ」。送信・内部プロトコルの解析・リバースエンジニアリングは引き続き禁止。メッセージ形式は解析せず、届いた JSON からコメント形（`comment_type` と `id`）を拾うだけに留める（`src/lib/live/ws-feed.ts`）。規約リスクは社長が引き受ける
- 上記の例外以外の非公式 WebSocket、内部プロトコル解析、リバースエンジニアリング系の処理は実装してはならない
- Kick は公式 Pusher WebSocket、ニコ生は公式 NDGR のみ使用
- 各プラットフォームの利用規約に違反するコードを書かない

### Cloudflare Workers 制約

- バンドルサイズ 25MiB 上限。framer-motion・recharts 等の重いライブラリは next/dynamic で必ず遅延ロード
- CPU time 10ms / request（Free プラン）。重い処理は Durable Objects に分離
- DB クライアントはグローバルに保持しない。Route Handler・Server Action 内で都度インスタンス化
- nodejs_compat フラグ前提
- Edge Runtime ではなく Node.js Runtime（OpenNext で nodejs_compat 経由）

### Next.js 16.2 仕様

- params, searchParams は Promise → 必ず await
- middleware.ts を継続使用する（**proxy.ts への移行は禁止**）
  - Next.js 16.2 は proxy.ts を推奨するが opennextjs-cloudflare@1.x が proxy.ts を未サポート
  - proxy.ts は Edge Runtime 非互換 → Workers 上で Supabase セッション管理が壊れる
  - 移行条件: opennextjs-cloudflare が proxy.ts を公式サポートしたタイミングで再評価
  - 詳細: docs/migration/phase_warnings_w1_decision_20260512.md 参照
- デフォルトは dynamic、キャッシュには use cache ディレクティブを明示
- React 19.2 機能（View Transitions, useEffectEvent, Activity）が利用可能

### React 19 Server Action 仕様（フェーズ 2 で確認済み）

- form action のシグネチャは `(formData: FormData) => void | Promise<void>` のみ受け付ける
- エラーオブジェクトの return は型エラー → 禁止
- エラー処理は以下のいずれか：
  - **redirect で query param に乗せる**（推奨：Server Component 維持）
  - **useActionState フックを使う**（クライアントコンポーネント化が必要）
- Cloudflare Workers のバンドル削減のため redirect 方式を優先
- TagDeck では redirect 方式に統一（Cloudflare Workers バンドルサイズ最適化のため）

### Supabase Realtime 購読パターン

- channel().on().subscribe() を必ずチェーンで一気に呼ぶ
- subscribe() 後に on() を呼ぶと「cannot add postgres_changes callbacks after subscribe()」エラー
- React 19 Strict Mode で useEffect が 2 回実行されるため、クリーンアップ必須
- 標準パターン：
  - mounted フラグでアンマウント後の setState 防止
  - channel をローカル変数で管理（useRef よりシンプル）
  - クリーンアップで supabase.removeChannel(channel)
  - チャンネル名にユーザー ID を含めてユニーク化（例：`whowatch-monitor-${user.id}`）
- 初期データ取得は Route Handler 経由を推奨（RLS 未設定環境でも動作）

### shadcn/ui の API 差異（base-nova）

- shadcn は base-nova リリース以降、Radix UI から Base UI に移行
- ToggleGroup の API が変化：
  - 旧（Radix）：type="single" + value が単一値
  - 新（Base UI）：value が配列型 [selectedValue]、onValueChange が配列を返す
- 例：value={[selectedPlatform]} / onValueChange={(values) => values.at(-1)}
- 新規 shadcn コンポーネント追加時は API 仕様を確認すること

### 環境変数の書式（.env.local）

- KEY=VALUE 形式のみ（クォート不要）
- = の前後に空白を入れない
- KEY 名を重複させない（DATABASE_URL=DATABASE_URL=... は NG）
- パスワードに特殊文字（@ # ? : / + = & 空白）が含まれる場合は URL エンコード必須
  - @ → %40、# → %23、? → %3F、: → %3A、/ → %2F、+ → %2B
- DATABASE_URL は Supabase Transaction Pooler の URL を使用（Session Pooler ではない）
- .env.local 変更後はサーバー再起動必須（HMR では反映されない）
- パスワード等の機密情報は絶対にチャット・Git・ログに出さない

### モックデータと React Hydration

- モックデータ生成で Date.now() を使わない
  - SSR とクライアントハイドレーションで実行時刻がずれて Hydration mismatch を引き起こす
- 代わりに MOCK_BASE_TIME 定数（固定タイムスタンプ）を使う
  - 例：const MOCK_BASE_TIME = 1746662400000; // 2026-05-08T00:00:00Z
- Math.random() を使う場合はインデックスベースのハッシュか固定シード乱数（Lehmer LCG 等）を使う
- 副作用：MOCK_BASE_TIME の場合、相対時刻表示（〇分前 等）は時間経過でずれる
  - 実データに置換されるまでの暫定状態として許容
- Hydration mismatch の真の原因は Math.random() より Date.now() の方が多い、両方確認すること

## コードスタイル

- TypeScript strict モード
- インポートは `@/*` エイリアス使用
- shadcn/ui コンポーネントはコピペベース（再利用編集 OK）
- Tailwind v4 のユーティリティクラスのみ使用
- 日本語 UI、コメントは日本語、コードは英語
- ファイル名は kebab-case、コンポーネント名は PascalCase

## ディレクトリ構造

- `src/app/` ページ・ルート
- `src/components/` 再利用コンポーネント
- `src/lib/` ユーティリティ・クライアント
- `src/hooks/` カスタムフック
- `src/stores/` Zustand ストア
- `src/types/` 型定義
- `workers/` Cloudflare Workers 個別ワーカー（フェーズ 2 以降）

## 命名規則

- ストリーマー = 配信者
- リスナー = 視聴者
- ギフト = 投げ銭・アイテム
- プラットフォーム = ふわっち / Kick / ニコ生

## してほしいこと

- 段階的に実装し、各ステップで動作確認する
- 不明点は推測せず、社長に確認する
- 法務リスクのある実装提案は最初に拒否する

## してほしくないこと

- 非公式 API・スクレイピング系の実装提案
- グローバル DB クライアントの作成
- バンドルサイズを無視したライブラリ追加
- params の await 忘れ
