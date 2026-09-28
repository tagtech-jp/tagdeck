"""pytest テスト: sync_items_and_events.py

実行: cd D:\tagdeck\scripts\platforms\whowatch && pytest sync_items_and_events.test.py -v
"""
import json
import sys
import unittest.mock as mock
from io import BytesIO
from unittest.mock import MagicMock, patch, call

import pytest

import sync_items_and_events as sut


# ---------------------------------------------------------------------------
# fetch_json
# ---------------------------------------------------------------------------
class TestFetchJson:
    def _make_response(self, body: object):
        raw = json.dumps(body).encode("utf-8")
        resp = MagicMock()
        resp.read.return_value = raw
        resp.__enter__ = lambda s: s
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    def test_returns_parsed_json_on_success(self):
        payload = [{"id": 1, "name": "test"}]
        resp = self._make_response(payload)
        with patch("urllib.request.urlopen", return_value=resp):
            result = sut.fetch_json("https://example.com", "dev-id")
        assert result == payload

    def test_retries_once_on_first_failure(self):
        payload = {"ok": True}
        resp = self._make_response(payload)
        call_count = 0

        def side_effect(req, timeout):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise OSError("timeout")
            return resp

        with patch("urllib.request.urlopen", side_effect=side_effect):
            with patch("time.sleep"):
                result = sut.fetch_json("https://example.com", "dev-id")
        assert result == payload
        assert call_count == 2

    def test_raises_after_two_failures(self):
        with patch("urllib.request.urlopen", side_effect=OSError("fail")):
            with patch("time.sleep"):
                with pytest.raises(OSError):
                    sut.fetch_json("https://example.com", "dev-id")


# ---------------------------------------------------------------------------
# fetch_items
# ---------------------------------------------------------------------------
class TestFetchItems:
    def _api_response(self):
        return [
            {
                "category_name": "イベント",
                "play_item": [
                    {
                        "id": 10842,
                        "name": "トンでもない応援をするぶたさん",
                        "play_item_description": "応援アイテム",
                        "state": "OPEN",
                        # has_animation は product の decoration にある（2026-07 実 API・fixture を 2026-09-28 に修正）
                        "play_item_payment_product": [
                            {"price": 160, "product_id": "web.ranking.ouen_pig.1.sale", "decoration": {"has_animation": True}}
                        ],
                    },
                    {
                        "id": 10773,
                        "name": "イベント応援するゾウ!",
                        "description": None,
                        "has_animation": False,
                        "state": "OPEN",
                        "play_item_payment_product": [
                            {"price": 160, "product_id": "web.ranking.ouen_zou.1.sale"}
                        ],
                    },
                ],
            }
        ]

    def test_returns_correct_dict_structure(self):
        with patch.object(sut, "fetch_json", return_value=self._api_response()):
            items = sut.fetch_items("dev-id")
        assert len(items) == 2
        pig = next(i for i in items if i["item_id"] == "10842")
        assert pig["platform"] == "whowatch"
        assert pig["item_name"] == "トンでもない応援をするぶたさん"
        assert pig["base_point"] == 160
        assert pig["product_id"] == "web.ranking.ouen_pig.1.sale"
        assert pig["price_jpy"] == 160
        assert pig["whowatch_id"] == 10842
        assert pig["has_animation"] is True
        assert pig["state"] == "OPEN"

    def test_deduplicates_by_id(self):
        """同じ id が複数カテゴリに現れてもユニークになること。"""
        duplicate_response = [
            {"play_item": [{"id": 1, "name": "A", "play_item_payment_product": [{"price": 10, "product_id": "p1"}]}]},
            {"play_item": [{"id": 1, "name": "A", "play_item_payment_product": [{"price": 10, "product_id": "p1"}]}]},
        ]
        with patch.object(sut, "fetch_json", return_value=duplicate_response):
            items = sut.fetch_items("dev-id")
        assert len(items) == 1

    def test_item_without_products_uses_zero_price(self):
        response = [{"play_item": [{"id": 999, "name": "NoProduct", "play_item_payment_product": []}]}]
        with patch.object(sut, "fetch_json", return_value=response):
            items = sut.fetch_items("dev-id")
        assert items[0]["base_point"] == 0
        assert items[0]["product_id"] == ""


# ---------------------------------------------------------------------------
# fetch_events
# ---------------------------------------------------------------------------
class TestFetchEvents:
    def _api_response(self):
        return {
            "pre": [
                {
                    "id": 200,
                    "event_key": "upcoming_event",
                    "badge": {"text": "近日", "color": "#FF0000", "animation": False},
                    "banner": "https://example.com/banner.png",
                    "ended_at": 1780272000000,
                    "participants": None,
                }
            ],
            "open": [
                {
                    "id": 101,
                    "event_key": "monthly_2026_05",
                    "badge": None,
                    "banner": "",
                    "ended_at": 1780271999000,
                    "participants": "1234",
                }
            ],
            "closed": [],
        }

    def test_status_is_assigned_correctly(self):
        with patch.object(sut, "fetch_json", return_value=self._api_response()):
            events = sut.fetch_events("dev-id")
        statuses = {e["id"]: e["status"] for e in events}
        assert statuses[200] == "pre"
        assert statuses[101] == "open"

    def test_open_event_has_required_fields(self):
        with patch.object(sut, "fetch_json", return_value=self._api_response()):
            events = sut.fetch_events("dev-id")
        open_ev = next(e for e in events if e["id"] == 101)
        assert open_ev["event_key"] == "monthly_2026_05"
        assert open_ev["banner_url"] == ""
        assert open_ev["ended_at"] == "2026-05-31T23:59:59+00:00"

    def test_pre_event_badge_fields(self):
        with patch.object(sut, "fetch_json", return_value=self._api_response()):
            events = sut.fetch_events("dev-id")
        pre_ev = next(e for e in events if e["id"] == 200)
        assert pre_ev["badge_text"] == "近日"
        assert pre_ev["badge_color"] == "#FF0000"
        assert pre_ev["badge_animation"] is False
        assert pre_ev["banner_url"] == "https://example.com/banner.png"

    def test_empty_sections_produce_no_events(self):
        with patch.object(sut, "fetch_json", return_value={"pre": [], "open": [], "closed": []}):
            events = sut.fetch_events("dev-id")
        assert events == []


# ---------------------------------------------------------------------------
# reconcile_closed_events
# ---------------------------------------------------------------------------
class TestReconcileClosedEvents:
    def _make_response(self):
        resp = MagicMock()
        resp.read.return_value = b""
        resp.__enter__ = lambda s: s
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    def test_closes_rows_not_in_active_ids(self):
        resp = self._make_response()
        captured = {}

        def side_effect(req, timeout):
            captured["url"] = req.full_url
            captured["method"] = req.get_method()
            captured["body"] = json.loads(req.data)
            return resp

        with patch("urllib.request.urlopen", side_effect=side_effect):
            sut.reconcile_closed_events("https://x.supabase.co", "key", [101, 102])

        assert captured["method"] == "PATCH"
        assert "status=in.(pre,open)" in captured["url"]
        assert "id=not.in.(101,102)" in captured["url"]
        assert captured["body"] == {"status": "closed"}

    def test_closes_all_pre_open_rows_when_active_ids_empty(self):
        resp = self._make_response()
        captured = {}

        def side_effect(req, timeout):
            captured["url"] = req.full_url
            return resp

        with patch("urllib.request.urlopen", side_effect=side_effect):
            sut.reconcile_closed_events("https://x.supabase.co", "key", [])

        assert "status=in.(pre,open)" in captured["url"]
        assert "not.in" not in captured["url"]


# ---------------------------------------------------------------------------
# main — 環境変数チェック
# ---------------------------------------------------------------------------
class TestMainEnvValidation:
    def test_exits_when_device_id_missing(self):
        env = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "key"}
        with patch.dict("os.environ", env, clear=True):
            with pytest.raises(SystemExit) as exc:
                sut.main([])
        assert exc.value.code == 1

    def test_exits_when_supabase_url_missing(self):
        env = {"WHOWATCH_DEVICE_ID": "dev-id", "SUPABASE_SERVICE_ROLE_KEY": "key"}
        with patch.dict("os.environ", env, clear=True):
            with pytest.raises(SystemExit) as exc:
                sut.main([])
        assert exc.value.code == 1

    def test_exits_when_service_key_missing(self):
        env = {"WHOWATCH_DEVICE_ID": "dev-id", "SUPABASE_URL": "https://x.supabase.co"}
        with patch.dict("os.environ", env, clear=True):
            with pytest.raises(SystemExit) as exc:
                sut.main([])
        assert exc.value.code == 1


# ---------------------------------------------------------------------------
# main — 正常フロー
# ---------------------------------------------------------------------------
class TestMainHappyPath:
    def _env(self):
        return {
            "WHOWATCH_DEVICE_ID": "dev-id",
            "SUPABASE_URL": "https://x.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "service-key",
        }

    def test_outputs_json_on_success(self, capsys):
        items = [{"item_id": "1", "item_name": "A", "base_point": 160, "platform": "whowatch",
                  "product_id": "", "price_jpy": 0, "whowatch_id": 0,
                  "description": None, "has_animation": False, "state": "OPEN", "last_fetched_at": "t"}]
        events = [{"id": 101, "event_key": "ev", "banner_url": "", "status": "open",
                   "badge_text": None, "badge_color": None, "badge_animation": False,
                   "ended_at": None, "participants": None, "last_synced_at": "t"}]

        with patch.dict("os.environ", self._env(), clear=True):
            with patch.object(sut, "fetch_items", return_value=items):
                with patch.object(sut, "fetch_events", return_value=events):
                    with patch.object(sut, "supabase_upsert", side_effect=[1, 1]), patch.object(sut, "fetch_current_prices", return_value={"1": 160}):
                        with patch.object(sut, "reconcile_closed_events") as reconcile_mock:
                            with patch.object(sut, "notify_discord"):
                                sut.main([])

        captured = capsys.readouterr()
        result = json.loads(captured.out)
        assert result["items_synced"] == 1
        assert result["events_synced"] == 1
        assert result["prices_changed"] == 1  # 160 → 0
        assert result["items_free"] == 0
        assert "duration_ms" in result
        reconcile_mock.assert_called_once_with("https://x.supabase.co", "service-key", [101])

    def test_exits_on_items_fetch_failure(self):
        with patch.dict("os.environ", self._env(), clear=True):
            with patch.object(sut, "fetch_items", side_effect=RuntimeError("API down")):
                with patch.object(sut, "notify_discord"):
                    with pytest.raises(SystemExit) as exc:
                        sut.main([])
        assert exc.value.code == 1


# ---------------------------------------------------------------------------
# 2026-09-28 単価の定義統一・無料配布アイテム・ドライラン
# ---------------------------------------------------------------------------
class TestUnitPriceFromProducts:
    def test_min_quantity_open_product_divided_by_quantity(self):
        products = [
            {"price": 90, "quantity": 3, "product_id": "star.3", "state": "OPEN"},
            {"price": 1400, "quantity": 50, "product_id": "star.50", "state": "OPEN"},
        ]
        assert sut.unit_price_from_products(products) == {"price_jpy": 30, "product_id": "star.3", "state": "OPEN", "quantity": 3}

    def test_rounds_half_up_like_ts(self):
        assert sut.unit_price_from_products([{"price": 80, "quantity": 3, "product_id": "h"}])["price_jpy"] == 27
        assert sut.unit_price_from_products([{"price": 50, "quantity": 40, "product_id": "b"}])["price_jpy"] == 1

    def test_prefers_open_products_and_falls_back_to_all(self):
        products = [{"price": 160, "quantity": 1, "product_id": "a", "state": "CLOSED"}, {"price": 800, "quantity": 5, "product_id": "b", "state": "OPEN"}]
        assert sut.unit_price_from_products(products)["product_id"] == "b"
        assert sut.unit_price_from_products([{"price": 160, "quantity": 1, "product_id": "a", "state": "CLOSED"}]) == {"price_jpy": 160, "product_id": "a", "state": "CLOSED", "quantity": 1}

    def test_no_priced_products_is_none(self):
        assert sut.unit_price_from_products([]) is None
        assert sut.unit_price_from_products([{"price": 0, "product_id": "x"}]) is None


class TestEventKeyFromImageUrl:
    def test_event_folder(self):
        assert sut.event_key_from_image_url("https://img.whowatch.tv/events/2026/09_wolfcoming/item_free.png") == "2026_09_wolfcoming"
        assert sut.event_key_from_image_url("https://img.whowatch.tv/playitems/balloon/x.webp") is None
        assert sut.event_key_from_image_url(None) is None


class TestBuildItemRows:
    def _payments3(self):
        return [{"play_item": [
            {"id": 13100, "name": "おばあさんたぬっち", "play_item_payment_product": [
                {"price": 160, "quantity": 1, "product_id": "tanu.1", "state": "OPEN"}, {"price": 30000, "quantity": 200, "product_id": "tanu.200", "state": "OPEN"}]},
            {"id": 12880, "name": "スター", "play_item_payment_product": [{"price": 90, "quantity": 3, "product_id": "star.3", "state": "OPEN"}]},
        ]}]

    def _master(self):
        return [
            {"id": 13100, "name": "おばあさんたぬっち", "play_item_pattern": [{"image_url": "https://img.whowatch.tv/events/2026/09_wolfcoming/item_tanu.png"}]},
            {"id": 13097, "name": "赤ずきんダッシュサイコロ", "play_item_description": "おまけ", "play_item_pattern": [{"image_url": "https://img.whowatch.tv/events/2026/09_wolfcoming/item_dash.png"}]},
            {"id": 13099, "name": "赤ずきんサイコロ", "play_item_pattern": [{"image_url": "https://img.whowatch.tv/events/2026/09_wolfcoming/item_dice.png"}]},
            {"id": 13083, "name": "どんぐり（過去イベント）", "play_item_pattern": [{"image_url": "https://img.whowatch.tv/events/2026/08_autumn/item.png"}]},
            {"id": 1, "name": "風船（恒常・無料ではない）", "play_item_pattern": [{"image_url": "https://img.whowatch.tv/playitems/balloon/x.webp"}]},
        ]

    def test_paid_rows_use_unit_list_price_and_free_rows_come_from_master(self):
        rows = sut.build_item_rows(self._payments3(), self._master(), {"2026_09_wolfcoming"}, "t")
        by_id = {r["item_id"]: r for r in rows}
        assert set(by_id) == {"13100", "12880", "13097", "13099"}
        assert by_id["13100"]["price_jpy"] == 160 and by_id["13100"]["base_point"] == 160 and by_id["13100"]["product_id"] == "tanu.1" and by_id["13100"]["state"] == "OPEN"
        assert by_id["12880"]["price_jpy"] == 30
        assert by_id["13097"] == {
            "platform": "whowatch", "item_id": "13097", "item_name": "赤ずきんダッシュサイコロ", "base_point": 0, "product_id": "",
            "price_jpy": 0, "whowatch_id": 13097, "description": "おまけ", "has_animation": False, "state": "FREE", "last_fetched_at": "t",
        }

    def test_without_active_events_only_paid_rows(self):
        rows = sut.build_item_rows(self._payments3(), self._master(), set(), "t")
        assert {r["item_id"] for r in rows} == {"13100", "12880"}

    def test_payments3_only_still_works(self):
        rows = sut.build_item_rows(self._payments3(), [], {"2026_09_wolfcoming"}, "t")
        assert len(rows) == 2


class TestDiffPrices:
    def test_added_changed_free(self):
        rows = [
            {"item_id": "12880", "item_name": "スター", "price_jpy": 30, "state": "OPEN"},
            {"item_id": "13100", "item_name": "たぬ", "price_jpy": 160, "state": "OPEN"},
            {"item_id": "13097", "item_name": "ダッシュ", "price_jpy": 0, "state": "FREE"},
        ]
        d = sut.diff_prices({"12880": 90, "13100": 160}, rows)
        assert d["changed"] == [{"item_id": "12880", "item_name": "スター", "before": 90, "after": 30}]
        assert [a["item_id"] for a in d["added"]] == ["13097"]
        assert d["free"] == 1


class TestFetchItemsWithMaster:
    def test_fetches_master_only_when_active_keys_given(self):
        calls = []

        def fake(url, device_id):
            calls.append(url)
            if url.endswith("/playitems/payments3"):
                return [{"play_item": [{"id": 1, "name": "A", "play_item_payment_product": [{"price": 10, "quantity": 1, "product_id": "p1"}]}]}]
            return [{"id": 2, "name": "Free", "play_item_pattern": [{"image_url": "https://img.whowatch.tv/events/2026/09_x/i.png"}]}]

        with patch.object(sut, "fetch_json", side_effect=fake):
            rows = sut.fetch_items("dev-id", {"2026_09_x"})
        assert {r["item_id"] for r in rows} == {"1", "2"}
        assert calls == [f"{sut.BASE_URL}/playitems/payments3", f"{sut.BASE_URL}/playitems"]

    def test_master_failure_keeps_paid_rows(self):
        def fake(url, device_id):
            if url.endswith("/playitems"):
                raise RuntimeError("down")
            return [{"play_item": [{"id": 1, "name": "A", "play_item_payment_product": [{"price": 10, "product_id": "p1"}]}]}]

        with patch.object(sut, "fetch_json", side_effect=fake):
            rows = sut.fetch_items("dev-id", {"2026_09_x"})
        assert [r["item_id"] for r in rows] == ["1"]


class TestDryRun:
    def test_writes_rows_without_supabase(self, tmp_path, capsys):
        out = tmp_path / "rows.json"
        items = [{"item_id": "13097", "item_name": "x", "price_jpy": 0, "state": "FREE"}]
        events = [{"id": 1, "event_key": "2026_09_wolfcoming", "status": "open"}]
        with patch.dict("os.environ", {"WHOWATCH_DEVICE_ID": "dev-id"}, clear=True):
            with patch.object(sut, "fetch_events", return_value=events), patch.object(sut, "fetch_items", return_value=items) as fi:
                with patch.object(sut, "supabase_upsert") as up:
                    sut.main(["--dry-run", "--out", str(out)])
        up.assert_not_called()
        fi.assert_called_once_with("dev-id", {"2026_09_wolfcoming"})
        data = json.loads(out.read_text(encoding="utf-8"))
        assert data["free"] == 1 and data["items"] == items
        assert json.loads(capsys.readouterr().out)["dry_run"] is True
