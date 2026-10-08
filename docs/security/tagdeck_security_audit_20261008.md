# TagDeck（tagdeck.jp）セキュリティ監査 2026-10-08

- 対象: tagtech-jp/tagdeck `main` = cf69a4d（PR #99 まで）と本番 https://tagdeck.jp の応答
- 観点: 社長指示「個人情報が漏れないように・正確に決済できるように・満足できる仕様か」
- 方法: 全 API ルート（51 ファイル）・middleware・Supabase クライアント・RLS（0004〜0023 と supabase_*.sql）・Storage ポリシー・
  CI/デプロイ・外部 Worker（workers/）のコード読解、本番への未認証 GET（ページ・/api/*・静的ファイル・CORS 事前確認）、`pnpm audit --prod`
- 本番を動かす操作（POST・同期ルート・ログイン）は行っていない。Supabase の管理画面・Secrets の値は見ていない

## 0. 決済について（結論）

**tagdeck.jp に決済の実装は無い。** Stripe・KOMOJU・PAY.JP 等の連携コード・課金テーブル・購入画面はリポジトリに存在せず、
`docs/architecture/phase2_plan_v1.md` のとおり「課金未実装（Beta 無料）」のまま。したがって「正確に決済できるか」は現状、監査対象が無い。

関連する金額の扱いは **視聴者がふわっちで買ったギフトの定価の表示・集計**（TagDeck 自身は金銭を扱わない）:

| 項目 | 実装 | 評価 |
|---|---|---|
| 1 個の定価（円） | `whowatch_item_prices.unit_price_jpy`（payments3 の最小商品から・パック換算あり）。無ければ `item_point_mapping.price_jpy` | 2026-09-26/30 の修正で「先頭商品の価格を単価にしていた」誤りは解消済み |
| 1 回のギフト合計 | `total_yen = price_yen × count`（count = item_count × パターンの quantity） | 束パターン（風船 ×10）も合算。正しい |
| 無料アイテム | `state=FREE` / `is_free` → `price_yen=null`（0 で埋めない） | 推測で 0 を書かない方針と一致 |
| 実収（pt） | `learned_point`（erupi-commentbot が /present から学習）。運営者（EXPORT_OWNER_USER_ID）だけに表示 | 実収比率は他利用者に出ない |
| リスナー累計 `listeners.total_gift_amount` | whowatch は **個数**（`+ g.count`）、Kick は `+1`、CRM の rank 判定は `>= 50000` / `>= 10000`（円の想定） | **単位が混在**（§3-6）。金額ではなく個数が入るため CRM の「top / vip」判定はほぼ成立しない。利用者に見える数字の意味が崩れている |

スマホアプリ（tagtech-jp/tagdeck-mobile）は **Google Play の買い切り**（価格は社長が Play Console で設定・推奨 ¥1,500）で、
決済は Google が行い、アプリ内に課金コードは無い（`docs/PLAN.md`）。将来 Web 側で課金を始めるときは、別途「決済の監査」を行う。

## 1. 修正した項目（本 PR）

| # | 重さ | 内容 | 修正 |
|---|---|---|---|
| F1 | 中 | **セキュリティ関連ヘッダーが 1 つも無い**（本番で実測: HSTS・X-Frame-Options・X-Content-Type-Options・Referrer-Policy・CSP なし、`x-powered-by: Next.js` あり）。ログイン画面を他サイトの iframe に埋め込める（クリックジャッキング）、http:// で開いたときの中継者攻撃に弱い | `src/lib/security-headers.ts` を単一の定義元にし、`next.config.ts` の `headers()`（ページ・API）と `public/_headers` の `/*`（静的アセット。Worker の手前で配られるため別に書く）に同じ値を付ける。`poweredByHeader: false`。CSP は `frame-ancestors 'none'; base-uri 'self'; object-src 'none'` のみ（script-src は別件・§4-5） |
| F2 | 中 | **オープンリダイレクト**: `/auth/callback?next=` と `/auth/confirm?next=` が `${origin}${next}` で転送。`next=@evil.example` で `https://tagdeck.jp@evil.example`（host は evil.example）、`next=.evil.example` で `tagdeck.jp.evil.example` へ飛ぶ。成立にはコード交換の成功が要る（Supabase の redirect 許可リスト次第）が、ログイン直後の転送は信用されやすい | `src/lib/auth/safe-next.ts`（/ で始まる・// と /\ で始まらない・制御文字なし・相対解決して生成元が変わらない）で検証。既定は /dashboard |
| F3 | 低〜中 | **CSRF の防御が Cookie の SameSite=Lax だけ**。いまは成立しにくいが、ライブラリ更新等で属性が変わると気づけない。/api/* の書き込み（POST/PUT/PATCH/DELETE）に Origin の検査が無い | `src/lib/origin-guard.ts`: Origin が付いていて、自分のサイトでも許可したアプリ（Capacitor）でもなければ middleware が 403。Origin 無し（curl・GitHub Actions の同期）は従来どおり。`/api/auth/refresh` の既存の検査と同じ考え |
| F4 | 中 | **Storage の一覧が匿名で全件可**: 0014 の `"se: public read"` が `storage.objects` の SELECT を全ロール（anon 含む）に許可。公開バケットのダウンロードにこのポリシーは要らないが、**一覧**（`POST /storage/v1/object/list/se`）に効くため、バンドル内の匿名キーだけで全利用者のアップロード済み音源のパス（`{auth.users.id}/{SE キー}_{時刻}.{拡張子}`）を列挙できる。TagDeck は一覧 API を使っていない | `drizzle/0024_se_storage_list_own(.sql/_manual.sql/_rollback.sql)`: SELECT を `authenticated` かつ本人の階層だけに。**社長が SQL Editor で適用**（docs/migration-runbook.md）。コードの変更は不要なので、適用の前後どちらでマージしても壊れない |
| F5 | 高（稼働していれば） | **whowatch-poller（Render）の `/start` `/stop` が無認証**。Service Role Key（RLS バイパス）で任意の `streamer_id` に 5 秒ごとに `events` を INSERT させられる（他人の統計の汚染・無料枠の消費）。`tagdeck-whowatch-poller.onrender.com` は 404（この名前では稼働していない。別名での稼働は Render 管理画面で要確認）。呼び出し元のコードも TagDeck 側に無い（死にコードの可能性） | `POLLER_KEY`（X-Sync-Key・定数時間比較）を必須にし、未設定なら起動しない。`render.yaml` に envVar を追加。**稼働していないなら Render 側のサービス削除を推奨（社長判断）** |

## 2. 本番で確認できたこと（問題なし）

- `/api/*` は未認証 GET が全て 401 JSON（/api/build のコミット SHA だけ公開・設計どおり）。画面は /login へ転送
- 許可リストに無い Origin（例 https://evil.example）には CORS ヘッダーが付かない。許可した `https://localhost` にだけ付き、`Allow-Credentials` は無い
- robots.txt が /dashboard/ /api/ /auth/ を除外。sitemap は公開ページのみ
- 同期ルートの共有キーは長さ一致＋定数時間比較（`src/lib/whowatch/sync-auth.ts`）。`simulators/export` は共有キーでも利用者を指定できず運営者 1 人分のみ
- 認証: ログインの取り直しはサーバのみ（/api/auth/refresh は Origin 検査あり）。Bearer（アプリ）は `auth.getUser(token)` で本人確認し、PostgREST にも同じトークンを渡す
- 全 API ルートが `user.id` で絞っている（Drizzle は postgres ロールで RLS をバイパスするため、ルート側の条件が唯一の防御。51 ファイル中、他人の行に触れる経路は見つからなかった）。`ownedSimulator` で論理削除も除外
- 入力は zod で検証。外部 API（whowatch/Kick/ニコ生）への URL 組み立ては `encodeURIComponent` と英数字の正規表現で SSRF の余地なし。`payload.raw` の whowatch 生コメントから jwt は外し、匿名ギフトの投げ主は伏せている
- SE アップロード: パスは `{user.id}/…`、Content-Type は拡張子から正規化、20MB 上限。Storage の書き込みは本人の階層のみ（RLS）
- 秘密情報: ソース・docs に API キー・パスワードの直書きなし。`.gitignore` が `.env*`・`docs/backup/` を除外。Service Role Key はサーバ側（GitHub Secrets・Render）だけ
- RLS: users / streamer_profiles / listeners / events / event_simulators / event_history / se_mappings / se_presets / youtube_oauth_tokens は本人のみ。マスタ（item_*・whowatch_*・ranking_snapshots）は読み取りのみ。`item_point_mapping` の `learned_*` 列は 0023 で公開から外れている

## 3. 修正していない指摘（社長の判断が要る・別 PR）

| # | 重さ | 内容 | 提案 |
|---|---|---|---|
| 3-1 | **高** | **Next.js 16.2.4 に未修正の脆弱性**（`pnpm audit`）: critical 3 件（Windows ホストの RCE＝Workers では該当なし／Image Optimization の AVIF RCE＝`images.unoptimized: true` で未使用／next/og の RCE＝未使用）、high に **middleware バイパス**（segment-prefetch・動的ルートの引数注入・Turbopack 単一ロケール）、Server Components / Server Actions の DoS、Image Optimization の SSRF など。中身を見ると本番構成では致命的なものは無いが、middleware バイパスは本 PR の CSRF 検査と CORS を素通りさせうる（画面は `(dashboard)/layout.tsx` が、API は各ルートが二重に認証しているので情報漏えいには至らない） | **next 16.3.8 以上へ更新**。`@opennextjs/cloudflare` 1.20.9 は `next >=16.3.8` を要求し wrangler `^4.125.0` も要るため、3 つ同時に上げる。配信中（OBS 起動中）に D: で `pnpm install` をしないルールのため本セッションでは未着手。別 PR として提案カードを出す |
| 3-2 | 中 | `ws` 8.x（@supabase/supabase-js 経由・Realtime）に high（断片の多重送信によるメモリ枯渇）。Workers/ブラウザでは Node の `ws` を使わないので実害は限定的 | 3-1 と同じ PR で `@supabase/supabase-js` を最新へ |
| 3-3 | 低 | `shadcn`（CLI）が `dependencies` にあり、`pnpm audit` の 103 件のうち約半分（express・hono・js-yaml 等）はこの CLI の依存。実行時バンドルには入らない | `devDependencies` へ移す（lockfile の再生成が要る） |
| 3-4 | 中（整合性） | **`event_item_points`（イベントの基礎 pt・全利用者共有）をログイン済みなら誰でも PUT / DELETE できる**（`/api/platforms/whowatch/events/{key}/item-points`）。悪意ある利用者が値を書き換えると、全員の「あと◯個」換算（/api/live/rank-status）が狂う。誰が書いたかの記録も無い | 案 A: 書き込みを運営者（EXPORT_OWNER_USER_ID）だけにする（他利用者は提案だけ・別経路）。案 B: `updated_by` 列を足し、運営者以外の書き込みは `source='proposed'` として換算に使わない。いずれも設計判断なので未実装 |
| 3-5 | 中（法務） | **プライバシーポリシーの記載と実態の差**。`/privacy` は「メールアドレス・表示名等の登録情報は…認証目的にのみ使用」としか書いていないが、実際には **視聴者（第三者）の** プラットフォーム上の ID・表示名・コメント本文（Kick）・ギフトの個数と金額・入退室が `listeners` / `events` に保存され、配信者の CRM（メモ・ニックネーム）にも使われる。外部 API（whowatch・Kick・ニコ生）からの取得と、Supabase（DB/認証）・Cloudflare（配信基盤）への委託も書かれていない。個人情報保護法の「利用目的の特定・公表」に照らすと不足 | 文面案を §5 に置いた。公開文面は社長決裁のうえ `src/app/(legal)/privacy/page.tsx` を更新（tagtech.jp 共通ポリシー側との整合も） |
| 3-6 | 中（仕様） | **`listeners.total_gift_amount` の単位が混在**（whowatch は個数、Kick は 1 回 = 1）。`/api/listeners` の rank 判定（50,000 / 10,000）は円を前提にしており、CRM の top / vip がほぼ出ない。利用者に見える数字の意味が崩れている | whowatch は `+ total_yen`（null なら 0）にして円へ統一するか、列を `total_gift_count` と `total_gift_yen` に分ける。過去データの再集計（events から）も要るので別 PR |
| 3-7 | 低 | **退会（アカウント削除）・データの持ち出しの導線が無い**。利用者が自分のデータを消す手段が UI に無い（Supabase の管理画面で社長が消す運用になる） | 設定画面に「アカウントを削除」（auth.users の削除 → public.users の CASCADE）を追加。ベータ終了・有料化の前に必要 |
| 3-8 | 低 | **レート制限が無い**。`refresh-ranking` は 45 秒の抑制があるが、`/api/platforms/whowatch/events/{key}?refresh=1`・`live`・`live/poll` 等はログイン済みなら連打できる。TagDeck の Worker 経由で whowatch API を叩き続けると **TagDeck 側の IP が whowatch から遮断される**事業リスク | Cloudflare の WAF レート制限ルール（oborozuki.jp と同じ運用）を `/api/*` に。アプリ側は利用者ごとの簡易な抑制（KV）を別 PR |
| 3-9 | 低 | エラー応答に `detail: describeDbError(e)`（DB のエラー要約・列名等）を含むルートが数本（items/export・items/patterns・events/{key}・live）。SQL 全文は落としているので実害は小さい | 本番では `detail` を落としてログだけに残す |
| 3-10 | 低 | `whowatch-poller` と `youtube-relay` は TagDeck 側から呼ばれていない（死にコードの可能性）。Render の Free プランは 2026-05 以降の稼働状況が不明 | 稼働していなければ Render のサービス削除とディレクトリの退避（Never auto-delete・社長承認） |
| 3-11 | 情報 | Supabase Auth の設定（メール確認の必須化・レート制限・漏えいパスワードの拒否・MFA・redirect URL の許可リストにワイルドカードがあるか）はコードから分からない | 社長が Supabase Dashboard → Authentication で確認。特に **Redirect URLs に `https://tagdeck.jp/**` のようなワイルドカードがあると F2 の攻撃が成立しやすかった**（本 PR で入口は閉じた） |

## 4. 仕様としての所感（満足できるか）

- 認可の実装は丁寧（全ルートで本人確認・論理削除・匿名ギフトの伏せ方・jwt の非保存）。「漏れない」点は F4 を除いて良好
- 「正確に決済」は Web に決済が無いため評価不能。ギフトの金額計算は定価ベースで正しいが、§3-6 の累計の単位ずれが利用者に見える
- 不足は「規約・方針と実態の差」（§3-5）と「退会の導線」（§3-7）。ベータの間は許容されても、有料化・一般公開の前に埋める必要がある
- 運用面は Cloudflare の WAF（§3-8）と依存の更新（§3-1）。どちらもコードより設定・手順の問題

### 4-5. CSP（script-src）を入れなかった理由

Next の inline script、Supabase（REST/Realtime/Storage）、ふわっちのコメントサーバー（wss://ws.whowatch.tv）、Kick の Pusher、
Storage の音源 URL、外部のバナー画像をすべて列挙し、`'unsafe-inline'` を避けるには nonce を middleware で配る設計が要る。
誤ると画面が真っ白になるので、`frame-ancestors` / `base-uri` / `object-src` の 3 つだけを先に入れた。

## 5. プライバシーポリシー追記案（社長決裁用・公開前の文案）

> **収集する情報**
> - 登録情報: メールアドレス、表示名、ログインに使う外部サービス（Google / X / Discord）の識別子
> - 連携したプラットフォームの情報: ご自身のふわっち・Kick・ニコニコ生放送のユーザー ID、配信の状態（配信中か、視聴者数、獲得ポイント）
> - 配信中に取得する視聴者の情報: 視聴者のプラットフォーム上の ID と表示名、ギフト（アイテム）の種類・個数・定価、入退室、コメント本文（Kick のみ）。
>   これらは各プラットフォームの公開 API から取得し、配信者ご自身の統計・リスナー管理（メモ・ニックネーム）のためだけに保存します
> - SE 音源: アップロードした音声ファイル（公開 URL で配信されます。個人を特定できる内容を含めないでください）
>
> **利用目的**: 配信イベントの戦略支援・配信中の演出（効果音）・配信の振り返り・サービスの改善
>
> **委託・保存先**: データベースと認証は Supabase、配信基盤は Cloudflare、スマホアプリの配布と課金は Google Play を利用します。
> 第三者への提供は行いません（法令に基づく場合を除く）
>
> **保存期間・削除**: アカウントの削除をご希望の場合は【連絡先】までご連絡ください（削除後は復元できません）
>
> **視聴者の方へ**: 配信者が本サービスを利用している配信では、上記の視聴者情報が配信者の管理画面に保存されます。
> 削除のご依頼は【連絡先】まで

## 6. 適用手順（社長）

1. 本 PR の CI が緑になったらマージ（main への push で本番デプロイ）
2. ヘッダーの確認: `curl -sI https://tagdeck.jp/login | grep -i -E 'strict-transport|x-frame|content-security|x-powered'`
   → 3 行出て `x-powered-by` が出なければ OK。静的側: `curl -sI https://tagdeck.jp/robots.txt | grep -i x-frame`
3. Storage の一覧制限（F4）: Supabase SQL Editor で `drizzle/0024_se_storage_list_own_manual.sql` を実行。末尾の確認 SELECT が
   `se: own read / {authenticated}` の 1 行だけになること。/live の SE タブでアップロードと「既定に戻す」が動くこと
4. Render（F5）: 管理画面に whowatch-poller があれば `POLLER_KEY` を設定して再デプロイ。無ければ本項は不要（§3-10 の整理へ）
5. 別 PR（§3-1）: next 16.3.8 以上・@opennextjs/cloudflare 1.20.9・wrangler 4.125 以上・@supabase/supabase-js 最新への更新