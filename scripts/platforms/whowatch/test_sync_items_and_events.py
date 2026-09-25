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
                        "description": "応援アイテム",
                        "has_animation": True,
                        "state": "OPEN",
                        "play_item_payment_product": [
                            {"price": 160, "product_id": "web.ranking.ouen_pig.1.sale"}
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
                    "banner": {"url": "https://example.com/banner.png"},
                    "ended_at": "2026-06-01T00:00:00Z",
                    "participants": None,
                }
            ],
            "open": [
                {
                    "id": 101,
                    "event_key": "monthly_2026_05",
                    "badge": None,
                    "banner": {},
                    "ended_at": "2026-05-31T23:59:59Z",
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
        assert open_ev["ended_at"] == "2026-05-31T23:59:59Z"

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
                sut.main()
        assert exc.value.code == 1

    def test_exits_when_supabase_url_missing(self):
        env = {"WHOWATCH_DEVICE_ID": "dev-id", "SUPABASE_SERVICE_ROLE_KEY": "key"}
        with patch.dict("os.environ", env, clear=True):
            with pytest.raises(SystemExit) as exc:
                sut.main()
        assert exc.value.code == 1

    def test_exits_when_service_key_missing(self):
        env = {"WHOWATCH_DEVICE_ID": "dev-id", "SUPABASE_URL": "https://x.supabase.co"}
        with patch.dict("os.environ", env, clear=True):
            with pytest.raises(SystemExit) as exc:
                sut.main()
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
                    with patch.object(sut, "supabase_upsert", side_effect=[1, 1]):
                        with patch.object(sut, "reconcile_closed_events") as reconcile_mock:
                            with patch.object(sut, "notify_discord"):
                                sut.main()

        captured = capsys.readouterr()
        result = json.loads(captured.out)
        assert result["items_synced"] == 1
        assert result["events_synced"] == 1
        assert "duration_ms" in result
        reconcile_mock.assert_called_once_with("https://x.supabase.co", "service-key", [101])

    def test_exits_on_items_fetch_failure(self):
        with patch.dict("os.environ", self._env(), clear=True):
            with patch.object(sut, "fetch_items", side_effect=RuntimeError("API down")):
                with patch.object(sut, "notify_discord"):
                    with pytest.raises(SystemExit) as exc:
                        sut.main()
        assert exc.value.code == 1
