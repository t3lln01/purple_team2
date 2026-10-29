# Threat Model

## Project Overview

A Purple Team adversary-prioritization dashboard. A React/Vite client calls a Python FastAPI service that stores threat-model snapshots in PostgreSQL and integrates with CrowdStrike using server-held OAuth credentials. The application has no login or application-level authorization and must therefore be restricted at the network or deployment edge.

## Assets

- **CrowdStrike credentials and licensed intelligence** — OAuth client credentials, reports, raw actor records, MITRE mappings, and live actor metadata.
- **Threat-model business data** — quarterly actor assessments, monitoring decisions, overrides, evidence, high-value assets, and risk scores.
- **Service availability and third-party quota** — API and PostgreSQL capacity, durable application state, and CrowdStrike request quota.

## Trust Boundaries

- **Browser to FastAPI service** — all callers can read and modify application state because there is no application-level authorization.
- **API to PostgreSQL** — shared browser state, CrowdStrike credentials and results, and quarterly assessments are stored in one durable database.
- **API to CrowdStrike** — server-held credentials authorize paid/sensitive upstream queries; public callers must not be able to use them as an oracle.
- **Uploaded/external intelligence to browser rendering** — CrowdStrike responses, STIX/JSON/CSV uploads, and persisted overrides are untrusted display data.

## Scan Anchors

- Entry/setup: `artifacts/api-server/app/main.py`.
- Highest risk: `app/crowdstrike.py`, `app/exports.py`, and dashboard upload/render paths.
- All API endpoints are unauthenticated, including raw synchronized intelligence and mutable internal assessments.
- `artifacts/mockup-sandbox` is development-only unless production reachability is demonstrated.

## Threat Categories

### Spoofing and Elevation of Privilege
There are no application identities or privilege levels. Access control must be supplied by a private network, identity-aware proxy, or equivalent deployment-edge restriction.

### Tampering
Any caller can change credentials or threat-model state. The generic state API accepts only application-key prefixes and bounded request bodies, but does not authorize callers; the service must not be exposed to untrusted networks.

### Information Disclosure
Raw CrowdStrike sync results, actor records, quarterly assessments, monitoring state, and other internal intelligence are available to every caller. Network-level access restrictions are required unless that data is explicitly classified for public release.

### Denial of Service
Unauthenticated users must not trigger CrowdStrike-backed enumeration or unbounded response buffering. Request and stored-state sizes need limits appropriate to API quota, PostgreSQL capacity, and deployment resources.

### Injection
Uploaded, persisted, and upstream strings must be rendered as text rather than HTML. Filesystem paths and outbound hosts must remain server-controlled, and database operations must remain parameterized.
