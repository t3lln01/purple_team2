"""Read-only dashboard export API."""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from .storage import DATA_FILE, TM_DATA_FILE, current_quarter, load_json, load_version_store, now_iso

router = APIRouter()
_data: dict[str, Any] | None = None
_tm_data: dict[str, Any] | None = None


def data() -> dict[str, Any]:
    global _data
    if _data is None:
        _data = load_json(DATA_FILE, {})
    return _data


def tm_data() -> dict[str, Any]:
    global _tm_data
    if _tm_data is None:
        _tm_data = load_json(TM_DATA_FILE, {})
    return _tm_data


def csv_response(rows: list[dict[str, Any]], filename: str) -> Response:
    output = io.StringIO(newline="")
    if rows:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def reply(request: Request, rows: list[dict[str, Any]], **extra: Any) -> Response:
    if request.query_params.get("format", "json").lower() == "csv":
        filename = request.url.path.removeprefix("/api/").replace("/", "-") + ".csv"
        return csv_response(rows, filename)
    return JSONResponse({
        "ok": True,
        "meta": {
            "endpoint": request.url.path.removeprefix("/api"),
            "count": len(rows),
            "generatedAt": now_iso(),
            **extra,
        },
        "data": rows,
    })


def filters(request: Request) -> tuple[str, set[str]]:
    tactic = request.query_params.get("tactic", "").strip().lower()
    tids = {
        item.strip().upper()
        for item in request.query_params.get("tid", "").split(",")
        if item.strip()
    }
    return tactic, tids


ENDPOINTS = [
    ("/api/export", "This discovery index — lists all export endpoints."),
    ("/api/export/actor-prioritisation", "Actor priority rankings."),
    ("/api/export/threat-model", "Full quarterly threat model."),
    ("/api/export/threat-model/versions", "Saved threat model snapshots."),
    ("/api/export/risk-calculation", "Full risk calculation table."),
    ("/api/export/impact-table", "Technique impact table."),
    ("/api/export/likelihood-table", "Technique likelihood table."),
    ("/api/export/high-value-assets", "High-value asset scores."),
    ("/api/export/tid-priority", "Technique occurrence priority list."),
    ("/api/export/tactics-scores", "Tactic-level scores."),
    ("/api/export/all-procedures", "Observed ATT&CK procedures."),
    ("/api/export/scoring-framework", "Threat model scoring rubric."),
    ("/api/export/risk-rate", "Risk matrix and classification tables."),
]


@router.get("/export")
async def export_index() -> dict[str, Any]:
    return {
        "ok": True,
        "description": "Purple Team Dashboard — Export API. Every section is queryable as JSON or CSV.",
        "generatedAt": now_iso(),
        "endpoints": [{"path": path, "description": description, "params": []} for path, description in ENDPOINTS],
    }


@router.get("/export/actor-prioritisation")
async def actor_prioritisation(request: Request) -> Response:
    rows = [
        {key: actor.get(key) for key in ("name", "intent", "capability", "ttpRisk", "priority", "riskPct")}
        for actor in data().get("actors", [])
    ]
    return reply(request, rows, source="data.json › actors")


def _matches_list(name: str, malware: str, values: list[str]) -> bool:
    name, malware = name.upper(), malware.upper()
    return any(value.strip().upper() in {name} or value.strip().upper() in malware for value in values if value.strip())


@router.get("/export/threat-model/versions")
async def threat_model_versions(request: Request) -> dict[str, Any]:
    store = await load_version_store()
    rows = [{
        "quarter": quarter,
        "savedAt": entry.get("savedAt"),
        "seededFrom": entry.get("seededFrom"),
        "customActors": len(entry.get("customActors", [])),
        "actorOverrides": len(entry.get("actorOverrides", {})),
        "ppTapCount": len(entry.get("ppTapList", [])),
        "sirtCount": len(entry.get("sirtList", [])),
    } for quarter, entry in store.items()]
    return {"ok": True, "meta": {"generatedAt": now_iso(), "count": len(rows)}, "data": rows}


@router.get("/export/threat-model")
async def threat_model(request: Request) -> Response:
    quarter = request.query_params.get("quarter", "").strip() or current_quarter()
    entry = (await load_version_store()).get(quarter, {})
    overrides = entry.get("actorOverrides", {})
    pp_tap, sirt = entry.get("ppTapList", []), entry.get("sirtList", [])
    actors: list[dict[str, Any]] = []
    for actor in tm_data().get("threatModelActors", []):
        override = overrides.get(actor.get("name"), {})
        cs = override.get("csData", {})
        malware = cs.get("malware", actor.get("malware", ""))
        in_pp, in_sirt = _matches_list(actor["name"], malware, pp_tap), _matches_list(actor["name"], malware, sirt)
        intent = override.get("intentFinalScore", cs.get("intentFinalScore", actor.get("intentFinalScore")))
        capability = override.get("capabilityFinalScore", cs.get("capabilityFinalScore", actor.get("capabilityFinalScore")))
        actors.append({
            "name": actor["name"], "origins": cs.get("origins", actor.get("origins")),
            "aliases": cs.get("aliases", actor.get("aliases")), "actorType": cs.get("actorType", actor.get("actorType")),
            "lastSeen": cs.get("lastSeen", actor.get("lastSeen")), "malware": malware,
            "countries": cs.get("countries", actor.get("countries", [])), "industries": cs.get("industries", actor.get("industries", [])),
            "motivation": cs.get("motivation", actor.get("motivation", "")), "isCustom": False,
            "csEnriched": override.get("csEnriched", False), "csLastRefreshed": override.get("csLastRefreshed"),
            "monitored": override.get("inMonitoringList", actor.get("inMonitoringList")),
            "intentBaseScore": override.get("intentBaseScore", actor.get("intentScore")),
            "willingnessModifier": override.get("willingnessModifier", actor.get("willingnessScore")),
            "intentRationale": override.get("intentRationale", actor.get("intent", "")),
            "willingnessRationale": override.get("willingnessRationale", actor.get("willingness", "")),
            "capabilityBaseScore": override.get("capabilityBaseScore", actor.get("capabilitiesScore")),
            "noveltyModifier": override.get("noveltyModifier", actor.get("noveltyScore")),
            "capabilityRationale": override.get("capabilityRationale", actor.get("capabilities", "")),
            "noveltyRationale": override.get("noveltyRationale", actor.get("novelty", "")),
            "intentFinalScore": intent, "capabilityFinalScore": capability,
            "effectiveIntentScore": min(7, (intent or 0) + (1 if in_pp else 0) + (2 if in_sirt else 0)),
            "effectiveCapabilityScore": capability or 0, "inPpTap": in_pp, "inSirt": in_sirt,
            "description": cs.get("description", ""),
        })
    for actor in entry.get("customActors", []):
        in_pp = _matches_list(actor["name"], actor.get("malware", ""), pp_tap)
        in_sirt = _matches_list(actor["name"], actor.get("malware", ""), sirt)
        actors.append({
            **actor, "isCustom": True, "inPpTap": in_pp, "inSirt": in_sirt,
            "effectiveIntentScore": min(7, (actor.get("intentFinalScore") or 0) + (1 if in_pp else 0) + (2 if in_sirt else 0)),
            "effectiveCapabilityScore": actor.get("capabilityFinalScore") or 0,
        })
    if request.query_params.get("format", "json").lower() == "csv":
        return csv_response(actors, f"threat-model-{quarter.replace(' ', '-')}.csv")
    payload = {"quarter": quarter, "savedAt": entry.get("savedAt"), "seededFrom": entry.get("seededFrom"), "ppTapList": pp_tap, "sirtList": sirt, "actors": actors}
    return JSONResponse({"ok": True, "meta": {"endpoint": "/export/threat-model", "quarter": quarter, "count": len(actors), "generatedAt": now_iso(), "filters": {"quarter": quarter}, "availableFilters": ["quarter", "format"]}, "data": payload})


RISK_KEYS = {
    "TID": "tid", "Technique Name": "technique", "Platforms": "platforms", "Tactic": "tactic",
    "Confidentiality": "confidentiality", "Confidentiality Score": "confidentialityScore",
    "Integrity": "integrity", "Integrity Score": "integrityScore", "Availability": "availability",
    "Availability Score": "availabilityScore", "CIA Score": "ciaScore", "TTP Extent Score": "ttpExtentScore",
    "HIGH VALUE ASSSET RISK": "hvaRisk", "Impact Score": "impactScore", "Impact Rate": "impactRate",
    "TID  Priority": "tidPriority", "Last Occurrence": "lastOccurrence",
    "Last occurrence Score": "lastOccurrenceScore", "Confidence": "confidence",
    "Confidence Score": "confidenceScore", "Likelihood Score": "likelihoodScore",
    "Likelihood Rate": "likelihoodRate", "Risk Rate": "riskRate", "Risk Scores": "riskScore",
}


def _filtered_rows(request: Request, source: list[dict[str, Any]], tactic_key: str, tid_key: str) -> list[dict[str, Any]]:
    tactic, tids = filters(request)
    return [
        row for row in source
        if (not tactic or tactic in str(row.get(tactic_key, "")).lower())
        and (not tids or str(row.get(tid_key, "")).upper() in tids)
    ]


@router.get("/export/risk-calculation")
async def risk_calculation(request: Request) -> Response:
    rows = _filtered_rows(request, data().get("riskCalc", []), "Tactic", "TID")
    cleaned = [{target: row.get(source) for source, target in RISK_KEYS.items()} for row in rows]
    return reply(request, cleaned, filters=dict(request.query_params), availableFilters=["tactic", "tid", "format"])


@router.get("/export/impact-table")
async def impact_table(request: Request) -> Response:
    rows = _filtered_rows(request, data().get("impactTable", []), "tactics", "id")
    return reply(request, rows, filters=dict(request.query_params), availableFilters=["tactic", "tid", "format"])


@router.get("/export/likelihood-table")
async def likelihood_table(request: Request) -> Response:
    wanted = {"TID", "Technique Name", "Tactic", "TID  Priority", "Last Occurrence", "Last occurrence Score", "Confidence", "Confidence Score", "Likelihood Score", "Likelihood Rate"}
    rows = _filtered_rows(request, data().get("riskCalc", []), "Tactic", "TID")
    cleaned = [{RISK_KEYS[key]: row.get(key) for key in wanted} for row in rows]
    return reply(request, cleaned, filters=dict(request.query_params), availableFilters=["tactic", "tid", "format"])


@router.get("/export/high-value-assets")
async def high_value_assets(request: Request) -> Response:
    target = request.query_params.get("target", "").strip().lower()
    _, tids = filters(request)
    assets = [row for row in data().get("highvalue", []) if (not target or target in str(row.get("target", "")).lower()) and (not tids or str(row.get("tid", "")).upper() in tids)]
    if request.query_params.get("format", "json").lower() == "csv":
        return csv_response(assets, "high-value-assets.csv")
    aggregates = data().get("hvscores", [])
    return JSONResponse({"ok": True, "meta": {"endpoint": "/export/high-value-assets", "generatedAt": now_iso(), "hvaCount": len(assets), "aggregateCount": len(aggregates), "filters": dict(request.query_params), "availableFilters": ["target", "tid", "format"]}, "data": {"assets": assets, "aggregates": aggregates}})


@router.get("/export/tid-priority")
async def tid_priority(request: Request) -> Response:
    try:
        minimum = int(request.query_params.get("minCount", "0"))
    except ValueError:
        minimum = 0
    _, tids = filters(request)
    rows = [row for row in data().get("tidPriority", []) if int(row.get("count", 0)) >= minimum and (not tids or str(row.get("tid", "")).upper() in tids)]
    return reply(request, rows, filters=dict(request.query_params), availableFilters=["minCount", "tid", "format"])


@router.get("/export/tactics-scores")
async def tactics_scores(request: Request) -> Response:
    tactic = request.query_params.get("tactic", "").strip().lower()
    rows = [row for row in data().get("tactics", []) if not tactic or tactic in str(row.get("tactic", "")).lower()]
    return reply(request, rows, filters=dict(request.query_params), availableFilters=["tactic", "format"])


def _date_ms(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return None


@router.get("/export/all-procedures")
async def all_procedures(request: Request) -> Response:
    actor = request.query_params.get("actor", "").strip().lower()
    tactic, tids = filters(request)
    start, end = _date_ms(request.query_params.get("dateFrom")), _date_ms(request.query_params.get("dateTo"))
    try:
        limit = min(10000, int(request.query_params.get("limit", "5000"))) or 5000
    except ValueError:
        limit = 5000
    source, tactic_map, name_map = data().get("allProcedures", []), data().get("techTacticMap", {}), data().get("techNameMap", {})
    rows = []
    for row in source:
        tid, timestamp = str(row.get("mitreId", "")), row.get("date") or 0
        tactics = tactic_map.get(tid, [])
        if actor and actor not in str(row.get("actor", "")).lower(): continue
        if tids and tid.upper() not in tids: continue
        if tactic and not any(tactic in item.lower() for item in tactics): continue
        if start is not None and timestamp < start: continue
        if end is not None and timestamp > end: continue
        date = datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).date().isoformat() if timestamp else None
        rows.append({"actor": row.get("actor"), "mitreId": tid, "technique": name_map.get(tid), "tactics": "; ".join(tactics), "externalRef": row.get("externalRef"), "procedure": row.get("procedure"), "dateMs": row.get("date"), "date": date, "riskScore": row.get("risk")})
        if len(rows) >= limit: break
    return reply(request, rows, filters={**dict(request.query_params), "limit": limit}, availableFilters=["actor", "tid", "tactic", "dateFrom", "dateTo", "limit", "format"])


@router.get("/export/scoring-framework")
async def scoring_framework(request: Request) -> Response:
    return reply(request, tm_data().get("scoringFramework", []), source="threatModelData.json › scoringFramework")


@router.get("/export/risk-rate")
async def risk_rate() -> dict[str, Any]:
    levels = ["Very High", "High", "Medium", "Low", "Very Low"]
    values = [5, 4, 3, 2, 1]
    matrix = [{"impactLevel": impact, "likelihood": likelihood, "riskRate": values[i] * values[j]} for i, impact in enumerate(levels) for j, likelihood in enumerate(levels)]
    impact_levels = [
        {"level": "Very High", "min": 18, "max": None, "color": "#ef4444"},
        {"level": "High", "min": 10, "max": 17.99, "color": "#f97316"},
        {"level": "Medium", "min": 5, "max": 9.99, "color": "#eab308"},
        {"level": "Low", "min": 2, "max": 4.99, "color": "#84cc16"},
        {"level": "Very Low", "min": None, "max": 1.99, "color": "#22c55e"},
    ]
    likelihood_levels = [
        {"level": "Very High", "min": 60, "max": None, "description": "Very likely to occur"},
        {"level": "High", "min": 40, "max": 59.99, "description": "Likely to occur"},
        {"level": "Medium", "min": 20, "max": 39.99, "description": "Possible"},
        {"level": "Low", "min": 10, "max": 19.99, "description": "Unlikely"},
        {"level": "Very Low", "min": None, "max": 9.99, "description": "Rare"},
    ]
    risk_labels = {25: "Critical", 20: "Critical", 16: "High", 15: "High", 12: "High", 10: "Medium", 9: "Medium", 8: "Medium", 6: "Low", 5: "Low", 4: "Low", 3: "Low", 2: "Very Low", 1: "Very Low"}
    colors = {25: "#7f1d1d", 20: "#991b1b", 16: "#c2410c", 15: "#ea580c", 12: "#f97316", 10: "#ca8a04", 9: "#eab308", 8: "#a3e635", 6: "#65a30d", 5: "#16a34a", 4: "#15803d", 3: "#166534", 2: "#14532d", 1: "#052e16"}
    score_table = [{"riskRate": score, "label": risk_labels[score], "color": colors[score]} for score in risk_labels]
    return {"ok": True, "meta": {"endpoint": "/api/export/risk-rate", "generatedAt": now_iso()}, "data": {"riskMatrix": matrix, "impactLevels": impact_levels, "likelihoodLevels": likelihood_levels, "riskScoreTable": score_table}}


@router.get("/export/openapi.json")
async def export_openapi(request: Request) -> Response:
    paths = {path.removeprefix("/api"): {"get": {"summary": description, "responses": {"200": {"description": "Successful response"}}}} for path, description in ENDPOINTS}
    spec = {"openapi": "3.0.3", "info": {"title": "Purple Team Dashboard — Export API", "version": "1.0.0"}, "servers": [{"url": "/api"}], "paths": paths}
    return JSONResponse(spec, headers={"Content-Disposition": 'attachment; filename="purple-team-export-api.openapi.json"'})
