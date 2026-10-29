"""Durable JSON/file and PostgreSQL storage used by the API."""

from __future__ import annotations

import json
import os
import re
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

ROOT = Path(__file__).resolve().parent.parent
SYNC_FILE = ROOT / "cs-sync-state.json"
CREDS_FILE = ROOT / "cs-credentials.json"
TM_STATE_FILE = ROOT / "cs-threat-model-state.json"
TM_VERSIONS_FILE = ROOT / "cs-threat-model-versions.json"
DASHBOARD_SRC = ROOT.parent / "purple-team-dashboard" / "src"
DATA_FILE = DASHBOARD_SRC / "data.json"
TM_DATA_FILE = DASHBOARD_SRC / "threatModelData.json"

DATABASE_URL = os.getenv("DATABASE_URL")
pool: AsyncConnectionPool | None = (
    AsyncConnectionPool(DATABASE_URL, open=False, kwargs={"row_factory": dict_row})
    if DATABASE_URL
    else None
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def empty_tm_state() -> dict[str, Any]:
    return {
        "customActors": [],
        "actorOverrides": {},
        "ppTapList": [],
        "sirtList": [],
        "autoAssessments": {},
        "monitoringState": {},
    }


async def start_database() -> None:
    if pool is None:
        raise RuntimeError("DATABASE_URL must be set. Did you forget to provision a database?")
    await pool.open()
    async with pool.connection() as connection:
        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS threat_model_snapshots (
                quarter text PRIMARY KEY,
                state jsonb NOT NULL,
                saved_at timestamptz,
                seeded_from text,
                updated_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS application_state (
                key text PRIMARY KEY,
                value jsonb NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        await connection.commit()


async def stop_database() -> None:
    if pool is not None:
        await pool.close()


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return deepcopy(fallback)


def save_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(value, indent=2))
    temporary.replace(path)


async def get_app_state(key: str, fallback: Any = None) -> Any:
    assert pool is not None
    async with pool.connection() as connection:
        row = await (await connection.execute(
            "SELECT value FROM application_state WHERE key = %s",
            (key,),
        )).fetchone()
    return deepcopy(fallback) if row is None else row["value"]


async def list_app_state(prefixes: tuple[str, ...] = ()) -> dict[str, Any]:
    assert pool is not None
    async with pool.connection() as connection:
        if prefixes:
            rows = await (await connection.execute(
                "SELECT key, value FROM application_state WHERE key LIKE ANY(%s) ORDER BY key",
                ([f"{prefix}%" for prefix in prefixes],),
            )).fetchall()
        else:
            rows = await (await connection.execute(
                "SELECT key, value FROM application_state ORDER BY key"
            )).fetchall()
    return {
        row["key"]: row["value"]
        for row in rows
        if not prefixes or row["key"].startswith(prefixes)
    }


async def set_app_state(key: str, value: Any) -> None:
    assert pool is not None
    async with pool.connection() as connection:
        await connection.execute(
            """
            INSERT INTO application_state (key, value)
            VALUES (%s, %s::jsonb)
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value,
                updated_at = now()
            """,
            (key, json.dumps(value)),
        )
        await connection.commit()


async def delete_app_state(key: str) -> None:
    assert pool is not None
    async with pool.connection() as connection:
        await connection.execute("DELETE FROM application_state WHERE key = %s", (key,))
        await connection.commit()


def current_quarter() -> str:
    now = datetime.now()
    if now.month == 1:
        return f"Q4 {now.year - 1}"
    if now.month <= 4:
        return f"Q1 {now.year}"
    if now.month <= 7:
        return f"Q2 {now.year}"
    if now.month <= 10:
        return f"Q3 {now.year}"
    return f"Q4 {now.year}"


def quarter_sort_key(label: str) -> int:
    match = re.fullmatch(r"Q(\d)\s+(\d{4})", label)
    return int(match.group(2)) * 10 + int(match.group(1)) if match else 0


async def _upsert_version(quarter: str, entry: dict[str, Any]) -> None:
    assert pool is not None
    state = {key: value for key, value in entry.items() if key not in {"savedAt", "seededFrom"}}
    async with pool.connection() as connection:
        await connection.execute(
            """
            INSERT INTO threat_model_snapshots (quarter, state, saved_at, seeded_from)
            VALUES (%s, %s::jsonb, %s, %s)
            ON CONFLICT (quarter) DO UPDATE SET
                state = EXCLUDED.state,
                saved_at = EXCLUDED.saved_at,
                seeded_from = EXCLUDED.seeded_from,
                updated_at = now()
            """,
            (quarter, json.dumps(state), entry.get("savedAt"), entry.get("seededFrom")),
        )
        await connection.commit()


async def load_version_store() -> dict[str, dict[str, Any]]:
    assert pool is not None
    async with pool.connection() as connection:
        rows = await (await connection.execute(
            "SELECT quarter, state, saved_at, seeded_from FROM threat_model_snapshots"
        )).fetchall()
    store = {
        row["quarter"]: {
            **row["state"],
            "savedAt": row["saved_at"].isoformat().replace("+00:00", "Z") if row["saved_at"] else None,
            **({"seededFrom": row["seeded_from"]} if row["seeded_from"] else {}),
        }
        for row in rows
    }
    if not store:
        legacy = load_json(TM_VERSIONS_FILE, {})
        if legacy:
            store = legacy
        else:
            live = load_json(TM_STATE_FILE, empty_tm_state())
            store = {"Q1 2025": {**empty_tm_state(), "savedAt": None}}
            if current_quarter() != "Q1 2025":
                store[current_quarter()] = {**live, "savedAt": now_iso()}
        for quarter, entry in store.items():
            await _upsert_version(quarter, entry)

    current = current_quarter()
    if current not in store:
        prior = [
            quarter for quarter, entry in store.items()
            if entry.get("savedAt") is not None and quarter_sort_key(quarter) <= quarter_sort_key(current)
        ]
        source_label = max(prior, key=quarter_sort_key) if prior else None
        if source_label:
            source = store[source_label]
            store[current] = {
                "customActors": deepcopy(source.get("customActors", [])),
                "actorOverrides": deepcopy(source.get("actorOverrides", {})),
                "ppTapList": deepcopy(source.get("ppTapList", [])),
                "sirtList": deepcopy(source.get("sirtList", [])),
                "monitoringState": deepcopy(source.get("monitoringState")),
                "autoAssessments": {},
                "savedAt": now_iso(),
                "seededFrom": source_label,
            }
        else:
            store[current] = {**empty_tm_state(), "savedAt": None}
        await _upsert_version(current, store[current])
    return store


async def load_tm_version(quarter: str) -> dict[str, Any]:
    entry = (await load_version_store()).get(quarter)
    if not entry:
        return {**empty_tm_state(), "savedAt": None, "hasSnapshot": False}
    return {
        **empty_tm_state(),
        **entry,
        "hasSnapshot": entry.get("savedAt") is not None,
    }


async def save_tm_version(quarter: str, state: dict[str, Any]) -> None:
    existing = (await load_version_store()).get(quarter, {})
    await _upsert_version(
        quarter,
        {
            **state,
            "savedAt": now_iso(),
            **({"seededFrom": existing["seededFrom"]} if existing.get("seededFrom") else {}),
        },
    )
