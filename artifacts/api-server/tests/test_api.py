from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app


class ApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # Deliberately avoid TestClient's context manager: these route-contract
        # tests do not need PostgreSQL startup.
        cls.client = TestClient(app)

    def test_health(self) -> None:
        response = self.client.get("/api/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_migrated_route_inventory(self) -> None:
        paths = {route.path for route in app.routes}
        expected = {
            "/api/healthz", "/api/cs/credentials", "/api/cs/status", "/api/cs/connect",
            "/api/cs/sync", "/api/cs/sync-result", "/api/cs/actor",
            "/api/cs/actors/last-active", "/api/cs/threat-model-versions",
            "/api/cs/threat-model-state", "/api/export",
            "/api/export/actor-prioritisation", "/api/export/threat-model",
            "/api/export/threat-model/versions", "/api/export/risk-calculation",
            "/api/export/impact-table", "/api/export/likelihood-table",
            "/api/export/high-value-assets", "/api/export/tid-priority",
            "/api/export/tactics-scores", "/api/export/all-procedures",
            "/api/export/scoring-framework", "/api/export/risk-rate",
            "/api/export/openapi.json", "/api/state", "/api/state/{key}",
        }
        self.assertTrue(expected.issubset(paths))
        self.assertTrue({"/api/access/me", "/api/access/users", "/api/__clerk"}.isdisjoint(paths))

    def test_public_export(self) -> None:
        response = self.client.get("/api/export/actor-prioritisation")
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["meta"]["count"], len(body["data"]))
        self.assertGreater(body["meta"]["count"], 0)

    def test_csv_export(self) -> None:
        response = self.client.get("/api/export/tactics-scores?format=csv")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/csv"))
        self.assertIn("attachment;", response.headers["content-disposition"])

    def test_internal_read_is_public(self) -> None:
        with patch("app.crowdstrike.load_sync_state", new=AsyncMock(return_value={
            "status": "never", "lastSync": None, "syncStarted": None,
            "error": None, "meta": {"reportCount": 0, "actorCount": 0},
            "reports": [], "actors": [],
        })):
            response = self.client.get("/api/cs/status")
        self.assertEqual(response.status_code, 200)
        self.assertIn("status", response.json())

    def test_write_does_not_require_login(self) -> None:
        with patch("app.crowdstrike.load_sync_state", new=AsyncMock(return_value={
            "status": "never", "lastSync": None, "syncStarted": None,
            "error": None, "meta": {"reportCount": 0, "actorCount": 0},
            "reports": [], "actors": [],
        })):
            response = self.client.post("/api/cs/sync", json={})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_state_api_only_exposes_public_keys(self) -> None:
        load = AsyncMock(return_value={"pt_example": "saved"})
        with patch("app.state.list_app_state", new=load):
            response = self.client.get("/api/state")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True, "state": {"pt_example": "saved"}})
        load.assert_awaited_once_with(("pt_", "ds_", "tm-"))

    def test_state_api_persists_exact_local_storage_string(self) -> None:
        save = AsyncMock()
        with patch("app.state.set_app_state", new=save):
            response = self.client.put("/api/state/pt_example", json={"value": '{"a":1}'})
        self.assertEqual(response.status_code, 200)
        save.assert_awaited_once_with("pt_example", '{"a":1}')

    def test_state_api_rejects_internal_keys(self) -> None:
        save = AsyncMock()
        with patch("app.state.set_app_state", new=save):
            response = self.client.put("/api/state/cs_credentials", json={"value": "secret"})
        self.assertEqual(response.status_code, 400)
        save.assert_not_awaited()

    def test_body_limit(self) -> None:
        response = self.client.post(
            "/api/cs/sync",
            content=b"x" * (2 * 1024 * 1024 + 1),
            headers={"content-type": "application/octet-stream"},
        )
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
