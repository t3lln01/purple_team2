# Workspace

## Overview

React/pnpm frontend workspace with a Python FastAPI backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24 (frontend tooling)
- **Python version**: 3.13
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: FastAPI + Uvicorn
- **Database**: PostgreSQL + psycopg
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Python FastAPI server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   └── api-zod/            # Generated frontend schemas from OpenAPI
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server`

Python FastAPI service. Routes live in `app/`; PostgreSQL access uses psycopg and the existing `threat_model_snapshots` schema.

- Entry: `app/main.py` — creates FastAPI and mounts routes at `/api`
- Access: the API has no application-level authentication; restrict deployments at the network edge
- Routes: `app/crowdstrike.py`, `app/exports.py`, and `app/state.py`; health is `GET /api/healthz`
- **CrowdStrike routes** (`/api/cs/*`): `GET /cs/status`, `POST /cs/connect`, `POST /cs/sync`, `GET /cs/sync-result`; credentials and sync state persist in PostgreSQL; weekly auto-sync is triggered on startup when credentials exist and the last sync is more than 7 days old
- **Application state** (`/api/state`): persists tracked browser state in PostgreSQL; `localStorage` is hydrated as a client cache before React renders
- `python3 -m pip install -r artifacts/api-server/requirements.txt` — install dependencies
- `pnpm run dev:api` — run the development server
- Production runs Uvicorn directly; Python has no bundle step

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `artifacts/purple-team-dashboard` (`@workspace/purple-team-dashboard`)

React + Vite SPA — Purple Team Adversary Prioritisation dashboard (dark navy/purple theme, MITRE ATT&CK v16).

**Pages:**
- Actor Prioritisation — ranked threat actors by TTP risk score
- Risk Calculation — 200 priority techniques with CIA, impact, likelihood, risk scores; overridable via Impact Table
- **Impact Table** — all 656 ATT&CK techniques; editable CIA (Conf/Int/Avail) + 9 TTP extent factor scores; live formula recalculation; overrides saved to `pt_impact_overrides` localStorage; propagates to Risk Calculation; STIX bundle updates technique metadata (`pt_stix_techniques`)
- **High Value Assets** — editable asset-TID risk matrix; add new assets/TID mappings; edit Risk/Likelihood/Impact per row; custom rows highlighted (NEW badge); baseline rows editable/resettable; HVSCORES recomputed live and stored to `pt_hva_scores` localStorage; propagates into Risk Calculation Impact Score and Likelihood Score
- TID Priority — top-N technique frequency charts
- Tactic Scores — per-tactic CIA baseline cards
- Risk Rate — likelihood × impact matrix
- All Procedures — full 3608-row ATT&CK procedures table (filterable by `?mitre=` or `?tactic=` URL params)
- Data Sources — CSV reports, Enterprise ATT&CK STIX bundle, actor mapping files; Generate & Save View; **CrowdStrike Intel API connector** (weekly auto-sync of reports + actor MITRE ATT&CK data)

**Formula (verified vs Excel):**
- CIA Score = Conf(L=1,M=2,H=3) + Int(L=1,M=2.25,H=3.5) + Avail(L=1,M=2.5,H=4)
- TTP Extent = sum of 9 factor scores (from Impact_table sheet)
- Impact Score = CIA × TTPExtent × HVA_Risk
- Impact Rate: ≤10 VL / ≤12 L / ≤14 M / ≤16 H / >16 VH
- Likelihood Score = TIDPriority × LastOccScore × ConfidenceScore × HVA_Likelihood
- Risk Score = ImpactScore × LikelihoodScore

**Static data:** `src/data.json` — keys: riskCalc (200 rows), actors, highvalue, hvscores, tidPriority, tactics, actorRanking, monitoringList, allProcedures, techTacticMap, techNameMap, **impactTable (656 rows)**

**Utilities:**
- `src/utils/impactFormulas.ts` — all formula constants and helpers
- `src/hooks/useImpactOverrides.ts` — localStorage-backed override state

### `scripts` (`@workspace/scripts`)

Utility scripts package. TypeScript utilities live in `src/` with corresponding npm scripts. `scripts/dev.py` starts the Python API and Vite dashboard together.
