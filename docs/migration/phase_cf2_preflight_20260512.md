# Phase CF-2 事前調査レポート

**作成者**: CTO 真鍋玲央  
**作成日**: 2026-05-12  
**目的**: tagdeck.jp を Vercel から Cloudflare Workers へ切り替える前の現状記録  
**調査方法**: read-only（既存ファイル・コード・DNS・HTTP への変更ゼロ）

---

## 1. ネームサーバー（NS レコード）

```
; dig NS tagdeck.jp +short 相当（nslookup 結果）
tagdeck.jp  nameserver = jaziel.ns.cloudflare.com
tagdeck.jp  nameserver = clara.ns.cloudflare.com
```

**判定**: tagdeck.jp の NS は Cloudflare。DNS は Cloudflare が管理している。

---

## 2. A / AAAA / CNAME レコード

### A レコード

```
; dig A tagdeck.jp +short 相当（PowerShell Resolve-DnsName 結果）
tagdeck.jp  A  TTL=300  216.198.79.1
tagdeck.jp  A  TTL=300  64.29.17.1
```

Vercel の anycast IP。HTTP レスポンスヘッダーで Server: Vercel を確認済み。  
Cloudflare proxy（オレンジ雲）は **OFF**（DNS only）— Server ヘッダーが Vercel を素通しで返していることから判定。

### AAAA レコード

```
; dig AAAA tagdeck.jp +short
(レコードなし — SOA が返った)
```

IPv6 アドレスは設定されていない。

### CNAME レコード

```
; dig CNAME tagdeck.jp +short
(レコードなし — SOA が返った)
```

apex ドメインへの CNAME は RFC 上不可のため正常。

---

## 3. レジストラ判定（whois — 個人情報は記録しない）

JPRS whois データ（who.is 経由で取得）より Registrar 相当行のみ抜粋:

```
[Name]   XSERVER Inc.
[Email]  support@xserver.ne.jp
[Web]    https://www.xserver.co.jp

[登録年月日]  2026/05/08
[有効期限]    2027/05/31
[状態]        Active
[ロック状態]  DomainTransferLocked / AgentChangeLocked
```

**レジストラ: エックスサーバー株式会社（XSERVER Inc.）**  
Cloudflare Registrar ではない。ドメイン移管不要（NS 委任のみで移行可能）。

---

## 4. tagdeck.jp 現在の HTTP レスポンスヘッダー

調査日時: 2026-05-12 03:21 UTC

```
HTTP/1.1 200 OK
Age: 0
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
Content-Type: text/html; charset=utf-8
Date: Tue, 12 May 2026 03:21:08 GMT
Server: Vercel
Strict-Transport-Security: max-age=63072000
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
X-Matched-Path: /
X-Powered-By: Next.js
X-Vercel-Cache: MISS
X-Vercel-Enable-Rewrite-Caching: 1
X-Vercel-Id: kix1::iad1::xs576-1778556067997-25d2a7ce093c
```

**Vercel 経由であることの根拠**: `Server: Vercel` / `X-Vercel-Id` / `X-Vercel-Cache` が存在。

---

## 5. Cloudflare Workers 側（tagdeck.bb25xp.workers.dev）HTTP レスポンスヘッダー

調査日時: 2026-05-12 03:21 UTC

```
HTTP/1.1 200 OK
Date: Tue, 12 May 2026 03:21:10 GMT
Content-Type: text/html; charset=utf-8
Connection: keep-alive
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
x-opennext: 1
x-powered-by: Next.js
Server: cloudflare
CF-RAY: 9fa64aaf3afa760f-SEA
alt-svc: h3=":443"; ma=86400
```

**Workers 側が正常稼働していることの根拠**: `Server: cloudflare` / `CF-RAY` ヘッダーが存在。  
`x-opennext: 1` — opennextjs-cloudflare アダプターが正常動作中。  
HTTP 200 OK — アプリが正常にレスポンスを返している。

---

## 6. DNS 切替パターン判定

| パターン | 条件 | 該当 |
|---------|------|------|
| パターン1 | Cloudflare Registrar 管理（理想形） | ✗ |
| **パターン2** | **外部レジストラ + Cloudflare DNS（NS 委任済み）** | **✓ 該当** |
| パターン3 | 外部レジストラ + 外部 DNS（CNAME flattening が必要） | ✗ |

### 判定根拠

- NS = jaziel.ns.cloudflare.com / clara.ns.cloudflare.com → Cloudflare が DNS を管理
- レジストラ = XSERVER Inc. → 外部レジストラ
- Cloudflare Registrar ではないが NS は委任済みのため、ダッシュボード操作のみで Custom Domain 追加可能

### パターン2 の移行手順概要

1. Cloudflare Dashboard → Workers → tagdeck → Settings → Domains & Routes → Add Custom Domain → `tagdeck.jp` を入力
2. Cloudflare が自動的に DNS レコードを追加し、SSL 証明書を発行する
3. 既存の A レコード（216.198.79.1 / 64.29.17.1）は自動的に Workers 向けに書き換えられる
4. 完了まで 5〜15 分程度

詳細手順は `phase_cf2_runbook.md` を参照。

---

*本レポートに `.env` / credentials の内容は一切含まない*  
*作成: CTO 真鍋玲央 / 2026-05-12 / read-only 調査のみ*
