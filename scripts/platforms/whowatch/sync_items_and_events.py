#!/usr/bin/env python3
"""ふわっちアイテム・イベント一覧を API から取得し Supabase に同期する (n8n 毎日 0:00 JST)。

必須環境変数:
  WHOWATCH_DEVICE_ID         ふわっち device-id (例: tagdeck-1778297341715-55361068)
  SUPABASE_URL               Supabase プロジェクト URL
  SUPABASE_SERVICE_ROLE_KEY  Supabase サービスロールキー
省略可:
  DISCORD_WEBHOOK_TASK       Discord 通知 Webhook URL
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

USER_AGENT = "TagDeck/0.1 (+https://tagdeck.jp)"
BASE_URL = "https://api.whowatch.tv"
TIMEOUT = 30


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


def fetch_items(device_id: str) -> list:
    """playitems/payments3 から全アイテムを平坦化して返す。"""
    data = fetch_json(f"{BASE_URL}/playitems/payments3", device_id)
    now = datetime.now(timezone.utc).isoformat()
    items, seen = [], set()
    for category in data:
        for pi in category.get("play_item", []):
            item_id = pi.get("id")
            if item_id is None or item_id in seen:
                continue
            seen.add(item_id)
            products = pi.get("play_item_payment_product") or []
            price = 0
            product_id = ""
            state = "OPEN"
            if products:
                first = products[0]
                price = first.get("price", 0) or 0
                product_id = first.get("product_id", "") or ""
                state = first.get("state", "OPEN") or "OPEN"
            items.append({
                "platform": "whowatch",
                "item_id": str(item_id),
                "item_name": pi.get("name", "") or "",
                "base_point": price,
                "product_id": product_id,
                "price_jpy": price,
                "whowatch_id": item_id,
                "description": pi.get("play_item_description") or pi.get("product_description"),
                # has_animation は play_item 直下ではなく product の decoration の中にある（2026-09-22 実 API 確認）
                "has_animation": any(bool((p.get("decoration") or {}).get("has_animation")) for p in products),
                "state": state,
                "last_fetched_at": now,
            })
    return items


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
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        method="PATCH",
    )
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
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
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


def main() -> None:
    start = time.time()
    device_id = os.environ.get("WHOWATCH_DEVICE_ID", "")
    if not device_id:
        print("ERROR: WHOWATCH_DEVICE_ID is not set", file=sys.stderr)
        sys.exit(1)
    supabase_url = os.environ.get("SUPABASE_URL", "")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    discord = os.environ.get("DISCORD_WEBHOOK_TASK", "")
    if not supabase_url or not service_key:
        print("ERROR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set", file=sys.stderr)
        sys.exit(1)

    try:
        items = fetch_items(device_id)
        items_n = supabase_upsert(
            supabase_url, service_key, "item_point_mapping", "platform,item_id", items
        )
    except Exception as e:
        msg = f"[TagDeck] ふわっちアイテム同期 FAILED: {e}"
        notify_discord(discord, msg)
        print(msg, file=sys.stderr)
        sys.exit(1)

    try:
        events = fetch_events(device_id)
        events_n = supabase_upsert(
            supabase_url, service_key, "whowatch_events", "id", events
        )
        active_ids = [e["id"] for e in events if e["status"] != "closed"]
        reconcile_closed_events(supabase_url, service_key, active_ids)
    except Exception as e:
        msg = f"[TagDeck] ふわっちイベント同期 FAILED: {e}"
        notify_discord(discord, msg)
        print(msg, file=sys.stderr)
        sys.exit(1)

    duration_ms = int((time.time() - start) * 1000)
    result = {"items_synced": items_n, "events_synced": events_n, "duration_ms": duration_ms}
    print(json.dumps(result, ensure_ascii=False))
    notify_discord(discord, f"[TagDeck] ふわっち同期完了 ✅ {result}")


if __name__ == "__main__":
    main()