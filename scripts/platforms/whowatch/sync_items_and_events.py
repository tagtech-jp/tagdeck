#!/usr/bin/env python3
"""ふわっちアイテム・イベント一覧を API から取得し Supabase に同期する (GitHub Actions daily-sync.yml 毎日 0:00 JST)。

必須環境変数:
  WHOWATCH_DEVICE_ID         ふわっち device-id (例: tagdeck-1778297341715-55361068)
  SUPABASE_URL               Supabase プロジェクト URL
  SUPABASE_SERVICE_ROLE_KEY  Supabase サービスロールキー
省略可:
  DISCORD_WEBHOOK_TASK       Discord 通知 Webhook URL

オプション:
  --dry-run --out rows.json  DB に書かず、書き込む予定の行を JSON に出す（SUPABASE_* は不要）

item_point_mapping の列の意味（2026-09-28 社長決定・単価の定義を統一）:
  price_jpy    1 個あたりの定価（円・まとめ買い割引前）。payments3 の OPEN 商品のうち最小個数の商品の price ÷ quantity
               （四捨五入。OPEN が無ければ全商品から）。tagdeck SE 側の whowatch_item_prices.unit_price_jpy と同じ定義。
               無料配布アイテム（state=FREE）は 0
  base_point   price_jpy と同値（互換のため残す）
  product_id   定価の元になった商品の product_id。無料は ""
  state        OPEN / CLOSED（定価の元になった商品の state）/ FREE（イベントの無料配布・常設の無料アイテム・購入不可）
  whowatch_id  数値の item_id（WebSocket / ポーリングで届く play_item_id と同じ）

取得元:
  GET /playitems/payments3  買えるアイテムだけ（商品付き）。2026-09-28 実測 111 件。無料配布は載らない
  GET /playitems            全アイテムのマスタ（認証不要・約 1,980 件）。ここから「pre/open イベントの無料配布」を拾う:
                             画像 URL のフォルダ events/YYYY/MM_key/ がイベントの event_key（YYYY_MM_key）に一致するもの
                             （src/lib/whowatch/free-event-items.ts の eventKeyFromImageUrl と同じ規則）。
                             年だけ違う（MM_key が同じ）ものも一致とみなす。毎年開かれるイベントは前の年の画像を使い回すため
                             （2026-10-07: 2026_10_art の無料アイテム ブラシ・パレット・ベレー帽の画像が events/2022/10_art/ にあった）
                             過去イベントの無料アイテム・販売終了アイテムは価格不明なので行を作らない（0 を推測で書かない）
                             例外として、常設の無料アイテム（FIXED_FREE_ITEM_IDS）はマスタにあって買えなければ同じ形の無料の行にする

パックにしか入っていないアイテム（2026-09-30 社長指示「パックにしか入っていないアイテムも単価を計算して組み込んで」）:
  payments3 のパック（商品説明に「・アイテム名 x N個」の行がある商品）の中身のうち、単品で売っていないもの（銀の風船・銀の神 等）は
  price_jpy = 割引前のパック価格（Web の価格 + ラベル「N円お得！」の N）÷ 個数（単品の中身があれば、その定価の合計を引いた残り ÷ 限定の個数）。
  product_id はパックの商品、state はパックの商品の state、description は「パック換算: …」。src/lib/whowatch/pack-prices.ts と同じ計算。
  例: 銀の通常アイテムパック Web ¥1,900・「アプリより100円お得！」→ ¥2,000 ÷ 40 個 = ¥50（イベントのスコア 25 点 = 価格 ÷ 2 と一致）
"""
import argparse
import html as _html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)"
BASE_URL = "https://api.whowatch.tv"
TIMEOUT = 30

# 画像 URL のイベントフォルダ: https://img.whowatch.tv/events/2026/09_wolfcoming/item_free.png → 2026_09_wolfcoming
EVENT_FOLDER_RE = re.compile(r"/events/(\d{4})/(\d{2}_[A-Za-z0-9_-]+)/")
# 常設の無料アイテム（2026-09-30 社長指示「ふわっちくんメガホン（10863）を無料アイテムとして単価表に登録」）。
# 画像が日付の無いフォルダ（events/whowatch_megaphone/）にあり、イベントの無料配布の判定（EVENT_FOLDER_RE）に当たらない品。
# マスタにあって買えない（payments3・パックに無い）ときだけ、イベントの無料配布と同じ形の行（0 円・state FREE）を作る
FIXED_FREE_ITEM_IDS = frozenset({
    10863,  # ふわっちくんメガホン
})
# パックの中身の行（NFKC 後）: 「・銀の風船 x 10個」「・月見ハンバーガーx３個」
PACK_LINE_RE = re.compile(r"^・\s*(.+?)\s*[x×✕]\s*(\d+)\s*個")
# ラベルの割引額: 「250円お得！」「1,750円お得！」「アプリより100円お得！」
PACK_DISCOUNT_RE = re.compile(r"([\d,]+)\s*円\s*お得")
PACK_DESCRIPTION_PREFIX = "パック換算: "


def _headers(device_id: str) -> dict:
    return {
        "User-Agent": USER_AGENT,
        "x-whowatch-device-id": device_id,
        "origin": "https://whowatch.tv",
        "referer": "https://whowatch.tv/",
        "Accept": "application/json",
    }


def fetch_json(url: str, device_id: str) -> object:
    """タイムアウト 30 秒・1 回リトライ付きの JSON フェッチ。"""
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=_headers(device_id))
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read())
        except Exception:
            if attempt == 0:
                time.sleep(3)
                continue
            raise


def _epoch_ms_to_iso(value):
    """エポックミリ秒(int)を ISO 8601 文字列に変換。None/0/不正値は None。"""
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc).isoformat()
    except (ValueError, TypeError, OSError):
        return None


# ---------------------------------------------------------------------------
# 純関数（テスト対象）
# ---------------------------------------------------------------------------
def _qty(product: dict) -> int:
    q = product.get("quantity")
    return int(q) if isinstance(q, (int, float)) and q > 0 else 1


def unit_price_from_products(products: list) -> dict | None:
    """商品配列から「1 個あたりの定価」を求める。

    OPEN 商品のうち最小個数（同数なら安い方）の price ÷ quantity を四捨五入。OPEN が無ければ全商品から。
    価格の付いた商品が無ければ None（無料・価格なし）。
    返り値: {"price_jpy", "product_id", "state", "quantity"}
    """
    priced = [p for p in (products or []) if isinstance(p, dict) and (p.get("price") or 0) > 0]
    if not priced:
        return None
    open_ = [p for p in priced if (p.get("state") or "OPEN") == "OPEN"] or priced
    base = sorted(open_, key=lambda p: (_qty(p), p["price"]))[0]
    qty = _qty(base)
    return {
        # Python の round は偶数丸めなので、TS 側 (Math.round) と同じ「.5 は切り上げ」にする
        "price_jpy": int(base["price"] / qty + 0.5),
        "product_id": base.get("product_id", "") or "",
        "state": base.get("state", "OPEN") or "OPEN",
        "quantity": qty,
    }


def event_key_from_image_url(url) -> str | None:
    """画像 URL のイベントフォルダ（events/YYYY/MM_key/）から event_key（YYYY_MM_key）を作る。無ければ None"""
    if not isinstance(url, str):
        return None
    m = EVENT_FOLDER_RE.search(url)
    return f"{m.group(1)}_{m.group(2)}" if m else None


def event_suffix(key) -> str | None:
    """event_key（YYYY_MM_key）から年を外した MM_key。年が無い形なら None（src/lib/whowatch/free-event-items.ts の eventSuffix と同じ規則）"""
    m = re.match(r"^\d{4}_(\d{2}_.+)$", key or "")
    return m.group(1) if m else None


def in_active_event(image_keys: set, active_event_keys: set) -> bool:
    """画像のイベントフォルダが、開催中（pre/open）のイベントのものか。年だけ違う（MM_key が同じ）ものも含める。
    毎年開かれるイベントは前の年の画像を使い回す（2026-10-07: 2026_10_art の無料アイテム ブラシ・パレット・ベレー帽の
    画像が events/2022/10_art/ にあり、年が違うので単価表に載らず、学習した単価も書けなかった）"""
    if image_keys & active_event_keys:
        return True
    active_suffixes = {s for s in (event_suffix(k) for k in active_event_keys) if s}
    return bool({event_suffix(k) for k in image_keys} & active_suffixes)


def normalize_name(s) -> str:
    """アイテム名の比較用（NFKC・空白をまとめる）。「銀のいいね！」と「銀のいいね!」、全角数字をそろえる"""
    return re.sub(r"[ \t\u3000]+", " ", unicodedata.normalize("NFKC", s or "")).strip()


def parse_pack_contents(text) -> list:
    """商品説明（HTML・<br> 区切り）から「・アイテム名 x N個」の行を拾う。おまけの注記は拾わない。同じ名前は合計。

    返り値: [{"name": 正規化した名前, "quantity": N}]（src/lib/whowatch/pack-prices.ts の parsePackContents と同じ規則）
    """
    if not isinstance(text, str) or not text:
        return []
    plain = _html.unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", text, flags=re.I)))
    out = {}
    for line in plain.split("\n"):
        m = PACK_LINE_RE.match(normalize_name(line))
        if not m:
            continue
        name, qty = normalize_name(m.group(1)), int(m.group(2))
        if name and qty > 0:
            out[name] = out.get(name, 0) + qty
    return [{"name": n, "quantity": q} for n, q in out.items()]


def pack_list_price(price, label) -> float:
    """割引前のパック価格。ラベル「250円お得！」「アプリより100円お得！」の金額を足し戻す（金額の無い「お得！」はそのまま）"""
    m = PACK_DISCOUNT_RE.search(unicodedata.normalize("NFKC", label or ""))
    off = int(m.group(1).replace(",", "")) if m else 0
    return price + (off if off > 0 else 0)


def collect_pack_products(categories: list) -> list:
    """payments3 からパック（商品説明に中身の行がある商品）を集める。同じパックは 1 つにまとめ、載っているカテゴリを全部持つ"""
    by_id = {}
    for c in categories or []:
        group = c.get("group").strip() if isinstance(c.get("group"), str) else ""
        for pi in c.get("play_item") or []:
            pid = pi.get("id")
            if not isinstance(pid, int):
                continue
            if pid in by_id:
                if group and group not in by_id[pid]["group_keys"]:
                    by_id[pid]["group_keys"].append(group)
                continue
            cands = []
            for p in pi.get("play_item_payment_product") or []:
                if not isinstance(p, dict) or not ((p.get("price") or 0) > 0):
                    continue
                contents = parse_pack_contents((p.get("decoration") or {}).get("description") or pi.get("product_description"))
                if contents:
                    cands.append((p, contents))
            if not cands:
                continue
            open_ = [x for x in cands if (x[0].get("state") or "OPEN") == "OPEN"] or cands
            p, contents = sorted(open_, key=lambda x: (_qty(x[0]), x[0]["price"]))[0]
            q = _qty(p)
            by_id[pid] = {
                "pack_item_id": pid,
                "pack_name": pi.get("name") or "",
                "group_keys": [group] if group else [],
                "product_id": p.get("product_id") or str(p.get("id") or ""),
                "price": p["price"] / q,
                "list_price": pack_list_price(p["price"], (p.get("decoration") or {}).get("label")) / q,
                "state": p.get("state") or "OPEN",
                "image_url": p.get("image_url") or pi.get("image_url"),
                "contents": contents,
            }
    return list(by_id.values())


def _single_unit_prices(categories: list, pack_ids: set) -> tuple:
    """単品で売っているアイテムの定価（正規化した名前 → 円）と、その item_id の集合"""
    known, priced_ids = {}, set()
    for c in categories or []:
        for pi in c.get("play_item") or []:
            iid = pi.get("id")
            if iid is None or iid in pack_ids:
                continue
            unit = unit_price_from_products(pi.get("play_item_payment_product") or [])
            if unit:
                known[normalize_name(pi.get("name"))] = unit["price_jpy"]
                priced_ids.add(iid)
    return known, priced_ids


def has_pack_only_contents(categories: list) -> bool:
    """単品で売っていない中身を持つパックがあるか（マスタを取りに行くかの判断）"""
    packs = collect_pack_products(categories)
    if not packs:
        return False
    known, _ = _single_unit_prices(categories, {p["pack_item_id"] for p in packs})
    return any(c["name"] not in known for p in packs for c in p["contents"])


def pack_item_rows(categories: list, master_items: list, now: str) -> tuple:
    """パックにしか入っていないアイテムの item_point_mapping 行を作る（純関数）。返り値: (rows, unresolved)

    単価 = 割引前のパック価格 ÷ 個数（中身が全部パック限定のとき）。単品の中身があれば、その定価の合計を引いた残り ÷ 限定の個数
    （残りが 0 以下なら 割引前の価格 ÷ 全個数）。複数のパックに入っていれば 1 個あたりの高い方（割引の少ない方）。
    中身の名前はマスタ（/playitems）で引く。同名が複数あるときはパックと同じイベントフォルダのもの
    """
    packs = collect_pack_products(categories)
    if not packs:
        return [], []
    known, priced_ids = _single_unit_prices(categories, {p["pack_item_id"] for p in packs})
    refs = {}
    for it in master_items or []:
        iid = it.get("id")
        if not isinstance(iid, int) or iid in priced_ids:
            continue
        imgs = [p.get("image_url") for p in it.get("play_item_pattern") or [] if isinstance(p, dict)]
        img = next((u for u in imgs if event_key_from_image_url(u)), imgs[0] if imgs else None)
        refs.setdefault(normalize_name(it.get("name")), []).append({"item_id": iid, "item_name": it.get("name") or "", "image_url": img})
    best, unresolved = {}, []
    for pack in packs:
        pieces = sum(c["quantity"] for c in pack["contents"])
        if pieces <= 0 or pack["list_price"] <= 0:
            continue
        known_total = sum(known[c["name"]] * c["quantity"] for c in pack["contents"] if c["name"] in known)
        unknown_qty = sum(c["quantity"] for c in pack["contents"] if c["name"] not in known)
        if unknown_qty == 0:
            continue
        remainder = pack["list_price"] - known_total
        if known_total > 0 and remainder > 0:
            unit = remainder / unknown_qty
        elif known_total > 0:
            unit = pack["list_price"] / pieces
        else:
            unit = pack["list_price"] / unknown_qty
        min_unit = unit * pack["price"] / pack["list_price"]
        pack_folder = event_key_from_image_url(pack["image_url"])
        for c in pack["contents"]:
            if c["name"] in known:
                continue
            cands = refs.get(c["name"], [])
            if not cands:
                unresolved.append({"pack_name": pack["pack_name"], "name": c["name"], "reason": "マスタに同じ名前のアイテムが無い"})
                continue
            same = [r for r in cands if pack_folder and event_key_from_image_url(r["image_url"]) == pack_folder]
            for r in same or cands:
                cur = best.get(r["item_id"])
                if cur is None or unit > cur["unit"] or (unit == cur["unit"] and pack["price"] < cur["pack"]["price"]):
                    best[r["item_id"]] = {"unit": unit, "min_unit": min_unit, "ref": r, "pack": pack, "pieces": pieces}
    rows = []
    for iid in sorted(best):
        b = best[iid]
        pack = b["pack"]
        price = int(b["unit"] + 0.5)  # TS 側 (Math.round) と同じ「.5 は切り上げ」
        rows.append({
            "platform": "whowatch",
            "item_id": str(iid),
            "item_name": b["ref"]["item_name"],
            "base_point": price,
            "product_id": pack["product_id"],
            "price_jpy": price,
            "whowatch_id": iid,
            "description": f"{PACK_DESCRIPTION_PREFIX}{pack['pack_name']} 割引前 ¥{int(pack['list_price'] + 0.5):,} ÷ {b['pieces']} 個（Web ¥{int(pack['price'] + 0.5):,}・1 個 ¥{int(b['min_unit'] + 0.5)}）",
            "has_animation": False,
            "state": pack["state"],
            "last_fetched_at": now,
        })
    return rows, unresolved


def build_item_rows(categories: list, master_items: list, active_event_keys: set, now: str, unresolved=None) -> list:
    """payments3（買えるアイテム）と /playitems（マスタ）から item_point_mapping の行を作る（純関数）。

    - payments3 にあるアイテム: 定価単価。商品が無ければ従来どおり 0（product_id ""・state OPEN）
    - パックにしか入っていないアイテム（銀の風船 等）: パックの価格から求めた定価単価（pack_item_rows）
    - マスタにだけあるアイテムのうち、画像フォルダが pre/open イベントに一致するもの: 無料配布（price 0・state FREE）
    - マスタにだけある常設の無料アイテム（FIXED_FREE_ITEM_IDS）: 同じ形の無料の行（イベントの有無に関係なく）
    - それ以外は行を作らない
    unresolved にリストを渡すと、マスタで名前が見つからなかったパックの中身を追記する
    """
    items, seen = [], set()
    for category in categories or []:
        for pi in category.get("play_item", []) or []:
            item_id = pi.get("id")
            if item_id is None or item_id in seen:
                continue
            seen.add(item_id)
            products = pi.get("play_item_payment_product") or []
            unit = unit_price_from_products(products)
            price = unit["price_jpy"] if unit else 0
            items.append({
                "platform": "whowatch",
                "item_id": str(item_id),
                "item_name": pi.get("name", "") or "",
                "base_point": price,
                "product_id": unit["product_id"] if unit else "",
                "price_jpy": price,
                "whowatch_id": item_id,
                "description": pi.get("play_item_description") or pi.get("product_description"),
                # has_animation は play_item 直下ではなく product の decoration の中にある（2026-09-22 実 API 確認）
                "has_animation": any(bool((p.get("decoration") or {}).get("has_animation")) for p in products),
                "state": unit["state"] if unit else "OPEN",
                "last_fetched_at": now,
            })
    # パックにしか入っていないアイテム（無料配布の判定より先に。パック限定は買えるので FREE にしない）
    pack_rows, pack_unresolved = pack_item_rows(categories, master_items, now)
    if unresolved is not None:
        unresolved.extend(pack_unresolved)
    for r in pack_rows:
        if r["whowatch_id"] in seen:
            continue
        seen.add(r["whowatch_id"])
        items.append(r)
    for it in master_items or []:
        item_id = it.get("id")
        if item_id is None or item_id in seen:
            continue
        patterns = it.get("play_item_pattern") or []
        keys = {event_key_from_image_url(p.get("image_url")) for p in patterns if isinstance(p, dict)}
        keys.discard(None)
        if item_id not in FIXED_FREE_ITEM_IDS and (not keys or not in_active_event(keys, set(active_event_keys or ()))):
            continue
        seen.add(item_id)
        items.append({
            "platform": "whowatch",
            "item_id": str(item_id),
            "item_name": it.get("name", "") or "",
            "base_point": 0,
            "product_id": "",
            "price_jpy": 0,
            "whowatch_id": item_id,
            "description": it.get("play_item_description") or None,
            "has_animation": False,
            "state": "FREE",
            "last_fetched_at": now,
        })
    return items


def diff_prices(current: dict, rows: list) -> dict:
    """現在の DB（item_id → price_jpy）と今回の行を比べ、追加・価格変更・無料の件数と明細を返す"""
    added, changed = [], []
    free = 0
    for r in rows:
        if r["state"] == "FREE":
            free += 1
        cur = current.get(r["item_id"])
        if cur is None:
            added.append({"item_id": r["item_id"], "item_name": r["item_name"], "price_jpy": r["price_jpy"], "state": r["state"]})
        elif cur != r["price_jpy"]:
            changed.append({"item_id": r["item_id"], "item_name": r["item_name"], "before": cur, "after": r["price_jpy"]})
    return {"added": added, "changed": changed, "free": free}


# ---------------------------------------------------------------------------
# 取得
# ---------------------------------------------------------------------------
def fetch_items(device_id: str, active_event_keys=None) -> list:
    """payments3（買えるアイテム）＋ /playitems（マスタ）から行を作る。マスタの取得失敗は payments3 だけで続ける"""
    data = fetch_json(f"{BASE_URL}/playitems/payments3", device_id)
    master = []
    # マスタは無料配布アイテム・常設の無料アイテムの補完と、パックにしか入っていないアイテムの item_id を引くのに使う
    if active_event_keys or FIXED_FREE_ITEM_IDS or has_pack_only_contents(data if isinstance(data, list) else []):
        try:
            m = fetch_json(f"{BASE_URL}/playitems", device_id)
            master = m if isinstance(m, list) else []
        except Exception as e:  # 取れなくても有料アイテムの同期は止めない
            print(f"WARN: /playitems の取得に失敗（無料配布・パック限定アイテムは今回追加しない）: {e}", file=sys.stderr)
    now = datetime.now(timezone.utc).isoformat()
    unresolved = []
    rows = build_item_rows(data, master, set(active_event_keys or ()), now, unresolved)
    if unresolved and master:
        print(f"WARN: パックの中身がマスタで見つからない: {json.dumps(unresolved, ensure_ascii=False)}", file=sys.stderr)
    return rows


def fetch_events(device_id: str) -> list:
    """event_lists から pre/open/closed を status 付きで返す。

    ふわっち API レスポンス構造 (2026-07 実測):
      { "pre": [...], "open": [...], "closed": [...] }
      各イベント: id / event_key / banner(文字列URL) / badge{text,color,animation} /
                  can_entry / text("参加人数: N人") / started_at / ended_at
      started_at / ended_at はエポックミリ秒(int)。日本語イベント名フィールドは無い。
    title_ja は本スクリプトでは扱わない (events route が events/{event_key} から取得しキャッシュ)。
    """
    data = fetch_json(f"{BASE_URL}/event_lists", device_id)
    now = datetime.now(timezone.utc).isoformat()
    events = []
    for status in ("pre", "open", "closed"):
        for ev in data.get(status) or []:
            badge = ev.get("badge") or {}
            events.append({
                "id": ev.get("id"),
                "event_key": ev.get("event_key", "") or "",
                "banner_url": ev.get("banner") or "",
                "status": status,
                "badge_text": badge.get("text"),
                "badge_color": badge.get("color"),
                "badge_animation": bool(badge.get("animation", False)),
                "started_at": _epoch_ms_to_iso(ev.get("started_at")),
                "ended_at": _epoch_ms_to_iso(ev.get("ended_at")),
                "participants": ev.get("text"),
                "last_synced_at": now,
            })
    return events


def active_event_keys(events: list) -> set:
    return {e["event_key"] for e in events if e.get("status") in ("pre", "open") and e.get("event_key")}


# ---------------------------------------------------------------------------
# Supabase
# ---------------------------------------------------------------------------
def _sb_headers(key: str, prefer: str) -> dict:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": prefer}


def fetch_current_prices(url: str, key: str) -> dict:
    """現在の item_point_mapping（platform=whowatch）を item_id → price_jpy で返す（差分報告用。失敗したら空）"""
    endpoint = f"{url}/rest/v1/item_point_mapping?platform=eq.whowatch&select=item_id,price_jpy&limit=10000"
    req = urllib.request.Request(endpoint, headers=_sb_headers(key, "return=representation"))
    with urllib.request.urlopen(req, timeout=30) as resp:
        rows = json.loads(resp.read())
    return {str(r.get("item_id")): r.get("price_jpy") for r in rows if r.get("item_id") is not None}


def reconcile_closed_events(url: str, key: str, active_ids: list) -> None:
    """今回の event_lists で pre/open だった id 以外の DB 行を closed に更新する。

    events route（オンデマンド同期）と同一ロジック。API のレスポンスから消えた
    (5月/6月イベント等、時間経過で pre/open/closed いずれのバケットにも出てこなくなった)
    行が open のまま残り続けるのを防ぐ。active_ids が空の場合は pre/open の全行を closed にする。
    """
    if active_ids:
        id_list = ",".join(str(i) for i in active_ids)
        filter_q = f"status=in.(pre,open)&id=not.in.({id_list})"
    else:
        filter_q = "status=in.(pre,open)"
    endpoint = f"{url}/rest/v1/whowatch_events?{filter_q}"
    body = json.dumps({"status": "closed"}).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, headers=_sb_headers(key, "return=minimal"), method="PATCH")
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def supabase_upsert(url: str, key: str, table: str, on_conflict: str, rows: list) -> int:
    """Supabase REST API で UPSERT (resolution=merge-duplicates)。

    on_conflict には UNIQUE 制約のカラム名をカンマ区切りで指定。
    例: 'platform,item_id' / 'id'
    """
    if not rows:
        return 0
    endpoint = f"{url}/rest/v1/{table}?on_conflict={on_conflict}"
    body = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, headers=_sb_headers(key, "resolution=merge-duplicates,return=minimal"), method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()
    return len(rows)


def notify_discord(webhook: str, message: str) -> None:
    if not webhook:
        return
    body = json.dumps({"content": message}).encode("utf-8")
    req = urllib.request.Request(
        webhook,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "TagTech-Bot/1.0"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def parse_args(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="ふわっちアイテム・イベントを Supabase に同期する")
    ap.add_argument("--dry-run", action="store_true", help="DB に書かず、書き込む予定の行を --out に JSON で出す")
    ap.add_argument("--out", default="", help="--dry-run の出力先（省略時は標準出力に件数だけ）")
    return ap.parse_args(argv)


def main(argv=None) -> None:
    start = time.time()
    args = parse_args(argv)
    device_id = os.environ.get("WHOWATCH_DEVICE_ID", "")
    if not device_id:
        print("ERROR: WHOWATCH_DEVICE_ID is not set", file=sys.stderr)
        sys.exit(1)
    supabase_url = os.environ.get("SUPABASE_URL", "")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    discord = os.environ.get("DISCORD_WEBHOOK_TASK", "")
    if not args.dry_run and (not supabase_url or not service_key):
        print("ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set", file=sys.stderr)
        sys.exit(1)

    # イベント一覧を先に取る（無料配布アイテムの判定に pre/open の event_key を使う）。失敗しても有料アイテムの同期は続ける
    events, events_error = [], None
    try:
        events = fetch_events(device_id)
    except Exception as e:
        events_error = e

    try:
        items = fetch_items(device_id, active_event_keys(events))
    except Exception as e:
        msg = f"[TagDeck] ふわっちアイテム同期 FAILED: {e}"
        notify_discord(discord, msg)
        print(msg, file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        payload = {"items": items, "events": events, "free": sum(1 for r in items if r["state"] == "FREE"), "from_packs": sum(1 for r in items if str(r.get("description") or "").startswith(PACK_DESCRIPTION_PREFIX))}
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=1)
        print(json.dumps({"dry_run": True, "items": len(items), "free": payload["free"], "from_packs": payload["from_packs"], "events": len(events), "out": args.out or None}, ensure_ascii=False))
        return

    # 差分報告（失敗しても同期は止めない）
    diff = {"added": [], "changed": [], "free": 0}
    try:
        diff = diff_prices(fetch_current_prices(supabase_url, service_key), items)
    except Exception as e:
        print(f"WARN: 現在の単価の取得に失敗（差分は報告しない）: {e}", file=sys.stderr)

    try:
        items_n = supabase_upsert(supabase_url, service_key, "item_point_mapping", "platform,item_id", items)
    except Exception as e:
        msg = f"[TagDeck] ふわっちアイテム同期 FAILED: {e}"
        notify_discord(discord, msg)
        print(msg, file=sys.stderr)
        sys.exit(1)

    try:
        if events_error:
            raise events_error
        events_n = supabase_upsert(supabase_url, service_key, "whowatch_events", "id", events)
        active_ids = [e["id"] for e in events if e["status"] != "closed"]
        reconcile_closed_events(supabase_url, service_key, active_ids)
    except Exception as e:
        msg = f"[TagDeck] ふわっちイベント同期 FAILED: {e}"
        notify_discord(discord, msg)
        print(msg, file=sys.stderr)
        sys.exit(1)

    duration_ms = int((time.time() - start) * 1000)
    result = {
        "items_synced": items_n,
        "items_free": sum(1 for r in items if r["state"] == "FREE"),
        "items_from_packs": sum(1 for r in items if str(r.get("description") or "").startswith(PACK_DESCRIPTION_PREFIX)),
        "items_added": len(diff["added"]),
        "prices_changed": len(diff["changed"]),
        "events_synced": events_n,
        "duration_ms": duration_ms,
    }
    print(json.dumps(result, ensure_ascii=False))
    # 明細（追加行・価格変更の before/after）は stderr へ（stdout は 1 行の JSON のまま。Actions のログでは両方見える）
    if diff["added"] or diff["changed"]:
        print(json.dumps({"added": diff["added"], "changed": diff["changed"]}, ensure_ascii=False), file=sys.stderr)
    notify_discord(discord, f"[TagDeck] ふわっち同期完了 ✅ {result}")


if __name__ == "__main__":
    main()
