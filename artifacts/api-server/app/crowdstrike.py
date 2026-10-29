"""CrowdStrike synchronization and quarterly threat-model APIs."""

from __future__ import annotations

import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from .storage import (
    CREDS_FILE,
    SYNC_FILE,
    current_quarter,
    delete_app_state,
    get_app_state,
    load_json,
    load_tm_version,
    load_version_store,
    now_iso,
    quarter_sort_key,
    save_tm_version,
    set_app_state,
)

router = APIRouter()
CS_BASE = "https://api.us-2.crowdstrike.com"
DEFAULT_STATE = {
    "status": "never", "lastSync": None, "syncStarted": None, "error": None,
    "meta": {"reportCount": 0, "actorCount": 0}, "reports": [], "actors": [],
}
stored_credentials: dict[str, str] | None = None
token_cache: tuple[str, float, str] | None = None
token_lock = asyncio.Lock()
sync_lock = asyncio.Lock()
last_active_cache: tuple[float, list[dict[str, Any]]] | None = None
last_active_lock = asyncio.Lock()
rate_limits: dict[str, dict[str, tuple[int, float]]] = {"search": {}, "directory": {}}


async def init_stored_credentials() -> None:
    global stored_credentials
    value = await get_app_state("cs_credentials")
    if value is None:
        legacy = load_json(CREDS_FILE, {})
        value = legacy if isinstance(legacy, dict) else {}
        if value.get("clientId") and value.get("clientSecret"):
            await set_app_state("cs_credentials", value)
            try:
                CREDS_FILE.unlink(missing_ok=True)
            except OSError:
                pass
    stored_credentials = value if isinstance(value, dict) and value.get("clientId") and value.get("clientSecret") else None


async def load_sync_state() -> dict[str, Any]:
    value = await get_app_state("cs_sync_state")
    if value is None:
        value = load_json(SYNC_FILE, DEFAULT_STATE)
        await set_app_state("cs_sync_state", value)
    return {**DEFAULT_STATE, **value} if isinstance(value, dict) else {**DEFAULT_STATE}


async def save_sync_state(value: dict[str, Any]) -> None:
    await set_app_state("cs_sync_state", value)


def active_credentials() -> tuple[str, str, str] | None:
    if os.getenv("CS_CLIENT_ID") and os.getenv("CS_CLIENT_SECRET"):
        return os.environ["CS_CLIENT_ID"], os.environ["CS_CLIENT_SECRET"], "env"
    if stored_credentials:
        return stored_credentials["clientId"], stored_credentials["clientSecret"], "stored"
    return None


async def token() -> str:
    global token_cache
    credentials = active_credentials()
    if not credentials:
        raise RuntimeError("CrowdStrike credentials are not configured. Enter them in Data Sources → CrowdStrike Intel API.")
    client_id, client_secret, source = credentials
    key = f"{source}:{client_id}"
    if token_cache and token_cache[1] > time.time() and token_cache[2] == key:
        return token_cache[0]
    async with token_lock:
        if token_cache and token_cache[1] > time.time() and token_cache[2] == key:
            return token_cache[0]
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{CS_BASE}/oauth2/token",
                data={"client_id": client_id, "client_secret": client_secret},
            )
        if response.status_code >= 400:
            raise RuntimeError(f"OAuth token request failed ({response.status_code}): {response.text[:200]}")
        payload = response.json()
        access_token = payload.get("access_token")
        if not access_token:
            raise RuntimeError("OAuth token response did not include an access token.")
        token_cache = (access_token, time.time() + max(1, int(payload.get("expires_in", 300)) - 30), key)
        return access_token


async def _get(client: httpx.AsyncClient, path: str, access_token: str, params: Any = None) -> dict[str, Any]:
    response = await client.get(f"{CS_BASE}{path}", params=params, headers={"Authorization": f"Bearer {access_token}"})
    if response.status_code >= 400:
        raise RuntimeError(f"CrowdStrike request failed ({response.status_code}): {response.text[:200]}")
    return response.json()


async def fetch_report_ids(client: httpx.AsyncClient, access_token: str, since: int | None) -> list[str]:
    ids, offset = [], 0
    while True:
        params: dict[str, Any] = {"limit": 5000, "offset": offset, "sort": "created_date|desc"}
        if since:
            params["filter"] = f"created_date:>={int((since - 48 * 60 * 60 * 1000) / 1000)}"
        payload = await _get(client, "/intel/queries/reports/v1", access_token, params)
        page = payload.get("resources", [])
        ids.extend(page)
        offset += len(page)
        if not page or offset >= payload.get("meta", {}).get("pagination", {}).get("total", 0):
            return ids


async def fetch_details(client: httpx.AsyncClient, access_token: str, path: str, ids: list[str]) -> list[dict[str, Any]]:
    result = []
    for start in range(0, len(ids), 100):
        try:
            payload = await _get(client, path, access_token, [("ids", item) for item in ids[start:start + 100]])
            result.extend(payload.get("resources", []))
        except Exception:
            continue
    return result


async def fetch_actor_ids(client: httpx.AsyncClient, access_token: str, maximum: int | None = None) -> list[str]:
    ids: list[str] = []
    offset: str | None = None
    while True:
        params = {"limit": "1000", **({"offset": offset} if offset else {})}
        payload = await _get(client, "/intel/queries/actors/v1", access_token, params)
        page = payload.get("resources", [])
        ids.extend(page)
        if maximum is not None and len(ids) > maximum:
            raise RuntimeError(f"CrowdStrike actor directory exceeds the {maximum} actor workload limit.")
        offset = payload.get("meta", {}).get("pagination", {}).get("offset")
        if not offset or not page:
            return ids


def normalize_mitre(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and isinstance(raw.get("resources"), list):
        return raw["resources"]
    if isinstance(raw, dict) and isinstance(raw.get("tactics"), list):
        return [{
            "tactic_name": tactic.get("name", tactic.get("tactic_name", "")),
            "technique_id": technique.get("technique_id", technique.get("id", "")),
            "technique_name": technique.get("technique_name", technique.get("name", "")),
            "reports": technique.get("reports", []), "observables": technique.get("observables", []),
        } for tactic in raw["tactics"] for technique in tactic.get("techniques", [])]
    return [raw] if isinstance(raw, dict) else []


async def sync_all(since: int | None = None) -> None:
    if sync_lock.locked() or not active_credentials():
        return
    async with sync_lock:
        state = await load_sync_state()
        state.update(status="running", syncStarted=now_iso(), error=None)
        await save_sync_state(state)
        try:
            access_token = await token()
            async with httpx.AsyncClient(timeout=60) as client:
                async def reports_job() -> list[dict[str, Any]]:
                    ids = await fetch_report_ids(client, access_token, since)
                    return await fetch_details(client, access_token, "/intel/entities/reports/v1", ids)

                async def actors_job() -> list[dict[str, Any]]:
                    ids = await fetch_actor_ids(client, access_token)
                    resources = await fetch_details(client, access_token, "/intel/entities/actors/v1", ids)
                    result = []
                    for actor in resources:
                        try:
                            raw = await _get(client, "/intel/entities/mitre-reports/v1", access_token, {"actor_id": actor.get("id"), "format": "JSON"})
                            entries = normalize_mitre(raw)
                            if entries:
                                name = str(actor.get("name") or actor.get("slug") or actor.get("id")).title()
                                result.append({"filename": f"{name}.json", "actor": name, "entries": entries})
                        except Exception:
                            pass
                        await asyncio.sleep(0.2)
                    return result

                report_result, actor_result = await asyncio.gather(
                    reports_job(), actors_job(), return_exceptions=True
                )
                reports = report_result if isinstance(report_result, list) else []
                actors = actor_result if isinstance(actor_result, list) else state.get("actors", [])
            merged = {str(item.get("slug") or item.get("id")): item for item in state.get("reports", [])}
            merged.update({str(item.get("slug") or item.get("id")): item for item in reports})
            values = list(merged.values())
            await save_sync_state({
                "status": "done", "lastSync": now_iso(), "syncStarted": state["syncStarted"], "error": None,
                "meta": {"reportCount": len(values), "actorCount": len(actors)}, "reports": values, "actors": actors,
            })
        except Exception as exc:
            await save_sync_state({**state, "status": "error", "error": str(exc)})


async def maybe_auto_sync() -> None:
    if not active_credentials() or sync_lock.locked():
        return
    state = await load_sync_state()
    if state["status"] == "running":
        state.update(status="error", error="Sync interrupted by server restart")
        await save_sync_state(state)
    last = datetime.fromisoformat(state["lastSync"].replace("Z", "+00:00")).timestamp() * 1000 if state.get("lastSync") else 0
    if time.time() * 1000 - last >= 7 * 24 * 60 * 60 * 1000:
        asyncio.create_task(sync_all(int(last) or None))


def normalize_date(value: Any) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, dict):
        return normalize_date(value.get("value") or value.get("date") or value.get("timestamp"))
    try:
        if isinstance(value, (int, float)) or str(value).isdigit():
            number = float(value)
            timestamp = number / 1000 if number > 1e11 else number
            return datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat()
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date().isoformat()
    except (ValueError, OverflowError):
        return None


def _resource_names(*values: Any) -> list[str]:
    result = []
    for value in values:
        for item in value if isinstance(value, list) else ([value] if value else []):
            name = item if isinstance(item, str) else item.get("name") or item.get("value") or item.get("title")
            if name and str(name).strip():
                result.append(str(name).strip())
    return result


def normalize_actor(resource: dict[str, Any]) -> dict[str, Any]:
    countries = [item.get("country") or item.get("name") for item in resource.get("target_countries", [])]
    industries = [item.get("name") for item in resource.get("target_industries", [])]
    malware = list(dict.fromkeys(_resource_names(resource.get("malware_used"), resource.get("malwareUsed"), resource.get("tools_used"), resource.get("toolsUsed"), resource.get("malware_families"), resource.get("malware_developed"), resource.get("malwareDeveloped"), resource.get("tools_developed"), resource.get("toolsDeveloped"))))
    origins = ", ".join(filter(None, [item.get("country") or item.get("name") for item in resource.get("origins", [])]))
    motivations = ", ".join(filter(None, [item.get("name") or item.get("value") for item in resource.get("motivations", [])]))
    aliases_value = resource.get("known_as", [])
    aliases = aliases_value if isinstance(aliases_value, str) else ", ".join(aliases_value)
    adversary_type = str(resource.get("adversary_type", ""))
    combined = f"{adversary_type} {motivations}".lower()
    actor_type = ""
    if "espionage" in combined or "state" in combined: actor_type = "Espionage — attacks impacting the Confidentiality of data or systems"
    elif "ecrime" in combined or "crime" in combined or "criminal" in combined: actor_type = "Cyber-Crime — attacks intended for near-term financial profit"
    elif "disrupt" in combined or "hacktivist" in combined: actor_type = "Disruptive — attacks impacting the Availability of data or systems"
    elif "destruct" in combined: actor_type = "Destructive — attacks impacting the Integrity of data or systems"
    capability = str((resource.get("capability") or {}).get("name", "")).lower()
    capability_score = 5 if any(word in capability for word in ("high", "advanced")) else 3 if any(word in capability for word in ("medium", "moderate")) else 2 if any(word in capability for word in ("low", "limited")) else None
    return {
        "name": str(resource.get("name", "")).upper(), "origins": origins, "aliases": aliases,
        "actorType": actor_type, "lastSeen": normalize_date(resource.get("last_active") or resource.get("last_active_date") or resource.get("last_activity_date") or resource.get("lastActivityDate")),
        "malware": ", ".join(malware), "countries": list(filter(None, countries)), "industries": list(filter(None, industries)),
        "intentFinalScore": None, "capabilityFinalScore": capability_score, "willingnessScore": None,
        "motivation": motivations, "adversaryType": adversary_type, "communityIds": aliases,
        "inMonitoringList": False, "isCustom": True, "csEnriched": True, "csLastRefreshed": now_iso(),
        "csRawData": resource, "description": resource.get("short_description") or resource.get("description", ""),
    }


def rate_limit(request: Request, bucket: str, maximum: int) -> None:
    user = request.client.host if request.client else "unknown"
    count, reset = rate_limits[bucket].get(user, (0, time.time() + 60))
    if reset <= time.time():
        count, reset = 0, time.time() + 60
    if count >= maximum:
        raise HTTPException(429, "Too many live CrowdStrike requests. Please try again later.", headers={"Retry-After": str(max(1, int(reset - time.time())))})
    rate_limits[bucket][user] = (count + 1, reset)


@router.get("/cs/credentials")
async def credentials_info(request: Request) -> dict[str, Any]:
    credentials = active_credentials()
    hint = f"{credentials[0][:3]}…{credentials[0][-3:]}" if credentials and len(credentials[0]) > 6 else ("•••" if credentials else None)
    return {"configured": bool(credentials), "source": credentials[2] if credentials else "none", "clientIdHint": hint}


@router.post("/cs/credentials")
async def save_credentials(request: Request) -> dict[str, bool]:
    global stored_credentials, token_cache
    body = await request.json()
    client_id, secret = str(body.get("clientId", "")).strip(), str(body.get("clientSecret", "")).strip()
    if not client_id or not secret:
        raise HTTPException(400, "clientId and clientSecret are required")
    credentials = {"clientId": client_id, "clientSecret": secret}
    await set_app_state("cs_credentials", credentials)
    stored_credentials = credentials
    token_cache = None
    return {"ok": True}


@router.delete("/cs/credentials")
async def delete_credentials(request: Request) -> dict[str, bool]:
    global stored_credentials, token_cache
    await delete_app_state("cs_credentials")
    try:
        CREDS_FILE.unlink(missing_ok=True)
    except OSError:
        pass
    stored_credentials, token_cache = None, None
    return {"ok": True}


@router.get("/cs/status")
async def status(request: Request) -> dict[str, Any]:
    state = await load_sync_state()
    last = datetime.fromisoformat(state["lastSync"].replace("Z", "+00:00")) if state.get("lastSync") else None
    next_sync = datetime.fromtimestamp(last.timestamp() + 7 * 86400, timezone.utc).isoformat().replace("+00:00", "Z") if last else None
    return {"hasCredentials": bool(active_credentials()), "status": state["status"], "lastSync": state["lastSync"], "nextSync": next_sync, "syncStarted": state["syncStarted"], "error": state["error"], "meta": state["meta"]}


@router.post("/cs/connect")
async def connect(request: Request) -> dict[str, bool]:
    try:
        await token()
        return {"ok": True}
    except Exception as exc:
        raise HTTPException(401, str(exc)) from exc


@router.post("/cs/sync")
async def sync(request: Request, background_tasks: BackgroundTasks) -> dict[str, Any]:
    if sync_lock.locked():
        raise HTTPException(409, "Sync already running")
    body = await request.json()
    state = await load_sync_state()
    last = int(datetime.fromisoformat(state["lastSync"].replace("Z", "+00:00")).timestamp() * 1000) if state.get("lastSync") else None
    since = None if body.get("full") or not last or time.time() * 1000 - last >= 30 * 86400 * 1000 else last
    background_tasks.add_task(sync_all, since)
    return {"ok": True, "message": "Sync started"}


@router.get("/cs/sync-result")
async def sync_result(request: Request) -> dict[str, Any]:
    return await load_sync_state()


@router.get("/cs/actor")
async def actor_search(request: Request, q: str = "") -> dict[str, Any]:
    rate_limit(request, "search", 20)
    if not q.strip():
        raise HTTPException(400, "q parameter is required")
    access_token = await token()
    async with httpx.AsyncClient(timeout=30) as client:
        payload = await _get(client, "/intel/combined/actors/v1", access_token, {"q": q.strip(), "limit": 5})
    resources = payload.get("resources", [])
    return {"ok": True, "actors": [normalize_actor(item) for item in resources], "raw": resources}


@router.get("/cs/actors/last-active")
async def actors_last_active(request: Request) -> dict[str, Any]:
    global last_active_cache
    rate_limit(request, "directory", 2)
    async with last_active_lock:
        if not last_active_cache or time.time() - last_active_cache[0] >= 3600:
            access_token = await token()
            async with httpx.AsyncClient(timeout=60) as client:
                ids = await fetch_actor_ids(client, access_token, 5000)
                resources = await fetch_details(client, access_token, "/intel/entities/actors/v1", ids)
            actors = [{"name": actor["name"], "aliases": [value.strip() for value in actor["aliases"].split(",") if value.strip()], "lastActive": actor["lastSeen"]} for actor in map(normalize_actor, resources)]
            last_active_cache = (time.time(), actors)
    return {"ok": True, "fetchedAt": datetime.fromtimestamp(last_active_cache[0], timezone.utc).isoformat().replace("+00:00", "Z"), "actors": last_active_cache[1]}


@router.get("/cs/threat-model-versions")
async def versions(request: Request) -> dict[str, Any]:
    store = await load_version_store()
    values = [{"quarter": quarter, "savedAt": entry.get("savedAt"), "seededFrom": entry.get("seededFrom"), "actorCount": len(entry.get("customActors", [])), "overrideCount": len(entry.get("actorOverrides", {})), "hasPpTap": bool(entry.get("ppTapList")), "hasSirt": bool(entry.get("sirtList"))} for quarter, entry in sorted(store.items(), key=lambda item: quarter_sort_key(item[0]))]
    return {"ok": True, "versions": values}


@router.get("/cs/threat-model-state")
async def get_threat_model_state(request: Request, quarter: str | None = None) -> dict[str, Any]:
    label = (quarter or "").strip() or current_quarter()
    return {"ok": True, "quarter": label, **await load_tm_version(label)}


@router.post("/cs/threat-model-state")
async def set_threat_model_state(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body.get("customActors"), list) or not isinstance(body.get("actorOverrides"), dict):
        raise HTTPException(400, "customActors (array) and actorOverrides (object) are required")
    label = str(body.get("quarter", "")).strip() or current_quarter()
    monitoring = body.get("monitoringState")
    state = {
        "customActors": body["customActors"], "actorOverrides": body["actorOverrides"],
        "ppTapList": body.get("ppTapList") if isinstance(body.get("ppTapList"), list) else [],
        "sirtList": body.get("sirtList") if isinstance(body.get("sirtList"), list) else [],
        "autoAssessments": body.get("autoAssessments") if isinstance(body.get("autoAssessments"), dict) else {},
        "monitoringState": {name: value is True for name, value in monitoring.items()} if isinstance(monitoring, dict) else None,
    }
    await save_tm_version(label, state)
    return {"ok": True, "quarter": label}
