"""Durable browser application-state API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .storage import delete_app_state, list_app_state, set_app_state

router = APIRouter()
PUBLIC_PREFIXES = ("pt_", "ds_", "tm-")
MAX_KEY_LENGTH = 256


class StateValue(BaseModel):
    value: str


def validate_public_key(key: str) -> str:
    if not key or len(key) > MAX_KEY_LENGTH or not key.startswith(PUBLIC_PREFIXES):
        raise HTTPException(400, "Invalid application-state key")
    return key


@router.get("/state")
async def get_state() -> dict[str, Any]:
    return {"ok": True, "state": await list_app_state(PUBLIC_PREFIXES)}


@router.put("/state/{key}")
async def put_state(key: str, body: StateValue) -> dict[str, bool]:
    await set_app_state(validate_public_key(key), body.value)
    return {"ok": True}


@router.delete("/state/{key}")
async def remove_state(key: str) -> dict[str, bool]:
    await delete_app_state(validate_public_key(key))
    return {"ok": True}
