# BOX Treat Intel Web App

A dark-themed React dashboard for visualising Adversary prioritisation, Mitre Att&ck TTPs prioritisation and Threat Model data mapped to the MITRE ATT&CK framework. Backed by a lightweight Node.js API server that handles CrowdStrike Intel API syncing.

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Node.js | 18+ (tested on v24) |
| pnpm | 9+ |

Install pnpm if you don't have it:

```bash
npm install -g pnpm
```

---

## Quick start

```bash
# 1. Clone the repo
git clone git@git.dev.box.net:sfiliaggi/threatintel
cd threatintel/

# 2. Install all workspace dependencies
pnpm install

# 3. Start both the API server and dashboard together
pnpm run dev
```

| Service | Default URL |
|---------|-------------|
| Dashboard | http://localhost:5173 |
| API server | http://localhost:8080 |

The dashboard proxies all `/api` requests to the API server automatically, so no additional configuration is needed for local development.

---

## CrowdStrike Intel API

The API server integrates with the CrowdStrike Falcon Intel API to automatically sync intelligence reports and actor MITRE ATT&CK data on a weekly schedule.

### Configuring credentials

You have two options:

**Option A — Environment variables** :

```bash
CS_CLIENT_ID=your_client_id
CS_CLIENT_SECRET=your_client_secret
```

**Option B — Dashboard UI** (convenient for local deployment):

1. Go to **Data Sources** → **CrowdStrike Intel API**
2. Click **Configure Credentials**
3. Enter your Client ID and Client Secret
4. Click **Save & Connect**

Credentials entered via the UI are saved to `artifacts/api-server/cs-credentials.json` on disk and are excluded from git. Environment variables always take precedence over UI-saved credentials.

To create a CrowdStrike API client: **Falcon Console → API Clients & Keys** — create a client with **Intel** read scope.

### Sync behaviour

- Syncs run automatically once a week
- The **Sync Now** button triggers an immediate sync
- Each sync fetches reports from the last 48 hours before the previous sync cutoff (prevents missing reports published near the window boundary)
- Reports accumulate across syncs — no historical data is lost when a newer sync returns fewer reports
- After a sync completes, click **Load sync result into dashboard** to merge the new procedures into Actor Prioritisation and All Procedures

### Additive merge

The sync never replaces your actor list. The 34 prioritised actors (with their intent/capability scores) always come from `data.json`. CrowdStrike procedures are **merged on top**, increasing TTP Risk scores without overwriting the base actor table.

---

## Ports and environment variables

| Variable | Service | Default | Description |
|----------|---------|---------|-------------|
| `PORT` | API server | `8080` | Port the Express server listens on |
| `PORT` | Dashboard | `5173` | Port Vite dev server listens on |
| `API_SERVER_PORT` | Dashboard | `8080` | Port the Vite proxy forwards `/api` requests to |
| `BASE_PATH` | Dashboard | `/` | URL base path (for subdirectory deployments) |
| `CS_CLIENT_ID` | API server | — | CrowdStrike Falcon API client ID |
| `CS_CLIENT_SECRET` | API server | — | CrowdStrike Falcon API client secret |

To run on custom ports:

```bash
# Start API server on port 9000
PORT=9000 pnpm --filter @workspace/api-server run dev

# Start dashboard pointing at port 9000
API_SERVER_PORT=9000 pnpm --filter @workspace/purple-team-dashboard run dev
```

Or create `artifacts/purple-team-dashboard/.env`:

```env
PORT=5173
API_SERVER_PORT=8080
```

---

## Production build

```bash
# Build the dashboard
pnpm --filter @workspace/purple-team-dashboard run build
# Output: artifacts/purple-team-dashboard/dist/public/

# Build the API server
pnpm --filter @workspace/api-server run build
# Output: artifacts/api-server/dist/

# Serve the dashboard build locally
pnpm --filter @workspace/purple-team-dashboard run serve
```

The dashboard `dist/public/` folder is a standard static-site bundle. The API server must be running alongside it in production to serve the `/api/cs/*` routes.

For a subdirectory deployment set `BASE_PATH` before building:

```bash
BASE_PATH=/purple-team/ pnpm --filter @workspace/purple-team-dashboard run build
```

---

## Project structure

```
/
├── artifacts/
│   ├── api-server/                    # Express API server
│   │   ├── src/
│   │   │   ├── index.ts               # Entry point (PORT defaults to 8080)
│   │   │   ├── app.ts                 # Express app + middleware
│   │   │   └── routes/
│   │   │       └── crowdstrike.ts     # CS Intel API sync + credential routes
│   │   ├── cs-sync-state.json         # Persisted sync state (reports + actor MITRE data)
│   │   └── cs-credentials.json        # UI-saved credentials (gitignored)
│   │
│   └── purple-team-dashboard/         # React + Vite dashboard
│       ├── src/
│       │   ├── data.json              # Static MITRE ATT&CK v16 seed data + actor list
│       │   ├── context/
│       │   │   ├── AppDataContext.tsx  # Global state (live actor data, MITRE versions)
│       │   │   └── ViewContext.tsx     # Procedure generation logic + localStorage helpers
│       │   └── pages/
│       │       ├── ActorPrioritisation.tsx
│       │       ├── RiskCalculation.tsx
│       │       ├── ImpactTable.tsx
│       │       ├── AllProcedures.tsx
│       │       └── DataSources.tsx
│       └── vite.config.ts             # Proxies /api → API server
├── package.json                       # Workspace root — `pnpm run dev` starts everything
└── pnpm-workspace.yaml
```

---

## Pages

| Page | Route | Description |
|------|-------|-------------|
| Actor Prioritisation | `/` | Ranked actor table, TTP risk chart, intent/capability scoring |
| Threat Model | `/threat-model` | Threat Model with options to add/remove actors from monitoring, change quarter, modify Intent and Capability for each actor |
| Risk Calculation | `/risk-calculation` | Per-technique risk scores |
| Impact Table | `/impact-table` | CIA impact matrix |
| High Value Assets | `/high-value-assets` | HVA matrix |
| TID Priority | `/tid-priority` | Threat intelligence directive scoring |
| Tactic Scores | `/tactics-scores` | MITRE tactic-level coverage breakdown |
| Risk Rate | `/risk-rate` | Risk rate heatmap |
| All Procedures | `/all-procedures` | Full searchable/filterable procedure table |
| Data Sources | `/data-sources` | Upload external data and sync CrowdStrike |
| API | `api-docs` | Every section of the Purple Team dashboard is queryable as JSON or CSV. All endpoints are read-only and require no authentication |
| Users | `users` | Create username and password accounts with write access to the dashboard | 

---

## Data Sources — uploading external intelligence

### 1. Reports (CSV or JSON)

**CSV format** (preferred):

| Column | Description | Example |
|--------|-------------|---------|
| `id` | Report identifier (case-insensitive match) | `CSA-240217` |
| `name` | Report title | `2024 Threat Intelligence Report` |
| `url` | Full URL to the report | `https://falcon.crowdstrike.com/...` |
| `date` | Publication date — **DD/MM/YYYY** | `17/02/2024` |

**JSON format** (`api_object.resources[]` or `resources[]`):

Fields used: `slug` (or `id`), `name`, `url`, `last_modified_date` → `last_updated` → `created_date` (tried in that order for the date).

### 2. Actor Mapping JSON

One JSON file per threat actor (e.g. `SCATTERED_SPIDER.json`). Each file is an array of TTP entries:

```json
[
  {
    "tactic_name": "Initial Access",
    "technique_id": "T1078",
    "technique_name": "Valid Accounts",
    "reports": ["CSA-240217", "CSB-230615"],
    "observables": ["Observed use of compromised credentials via Okta"]
  }
]
```

- Multiple files can be uploaded simultaneously — each becomes one actor.
- Actor name is inferred from the filename and can be renamed inline.
- `reports` entries are matched case-insensitively against the reports lookup.

### 3. Push to Actor Prioritisation

Once actor mapping files are loaded, click **Push to Actor Prioritisation** to merge the procedures into the live dashboard. This adds to TTP Risk scores without replacing the base actor list or intent/capability values.

### 4. MITRE ATT&CK (optional)

Fetch the Enterprise ATT&CK STIX bundle directly in-browser to enrich the dashboard with the latest technique data. The file is ~75 MB — if the fetch times out, download it manually and upload via the file picker.

---

## Procedure extraction rules

A procedure entry is included only when **all** of the following are true:

| Rule | Detail |
|------|--------|
| Non-empty observables | Entries where `observables` is empty are skipped — they produce no meaningful procedure text |
| Matched report | At least one report slug in the entry must resolve to a known report in the lookup |
| Resolvable date | The matched report must have a non-zero date (`last_modified_date` → `last_updated` → `created_date`) |

---

## localStorage keys

| Key | Contents |
|-----|----------|
| `pt_live_actor_data` | Merged live procedures from the last sync or manual push |
| `pt_actor_overrides` | Inline edits to actor intent/capability/label in the prioritisation table |
| `pt_actor_custom` | Custom actors added via the UI |
| `pt_procedures_custom` | Manually added procedures |
| `pt_mitre_versions_meta` | Loaded MITRE ATT&CK version metadata |
| `pt_active_mitre_version` | Currently selected MITRE version ID |
| `ds_actormap_files` | Uploaded actor mapping files (persisted for re-use) |
| `ds_reports_lookup` | Parsed reports lookup (keyed by uppercased report ID) |
| `ds_reports_stats` | Reports summary stats for the UI panel |
| `ds_mitre_stats` | MITRE ATT&CK parse summary |

---

## Tech stack

| Layer | Library |
|-------|---------|
| Frontend framework | React 19 + TypeScript |
| Build tool | Vite 7 |
| Styling | Tailwind CSS v4 |
| Routing | Wouter |
| Charts | Recharts |
| Icons | Lucide React |
| API server | Express + tsx |
| Package manager | pnpm (workspace monorepo) |

---

## Troubleshooting

**`ECONNREFUSED` on `/api/cs/status`**

The dashboard can't reach the API server. Make sure it's running:

```bash
pnpm --filter @workspace/api-server run dev
```

Or use `pnpm run dev` from the repo root to start both together.

**CrowdStrike sync returns 0 reports**

This is normal on incremental syncs when no new reports have been published since the last run. Previously synced reports are preserved in `cs-sync-state.json` and remain available via **Load sync result into dashboard**.

**Procedures not appearing after sync**

All three extraction rules must be satisfied: non-empty observables, a matched report, and a resolvable date. Check that your reports lookup contains the report IDs referenced in the actor mapping files.

**MITRE ATT&CK fetch fails**

The raw GitHub file is ~75 MB. Download it manually from the link shown on the error panel and upload it via the file picker.

**Node.js version**

```bash
node --version   # needs to be v18 or higher
pnpm --version   # needs to be v9 or higher
```

Install the latest Node.js LTS via [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install --lts
nvm use --lts
```
