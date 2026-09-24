# Scropcombinator — Hacker News Scraper

Full-stack solution that scrapes the **top 30 Hacker News entries**, filters and sorts them by **title word-count business rules**, audits every execution in **Firebase Firestore**, and supports **manual (on-demand)** and **scheduled (cron)** runs on **Cloudflare Workers**.

## Table of contents

- [Architecture](#architecture)
- [SOLID principles](#solid-principles)
- [Business rules](#business-rules)
- [Project structure](#project-structure)
- [Local installation](#local-installation)
- [Cloudflare deployment](#cloudflare-deployment)
- [Automated tests](#automated-tests)
- [Test files](#test-files)
- [Technical decisions](#technical-decisions)
- [API reference](#api-reference)
- [Security](#security)
- [Versioning](#versioning)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React + Vite)                              │
│  TopBar menu · Filter chips · Results table · Modals (Logs / Execution)     │
└──────────────┬──────────────────────────────────────┬───────────────────────┘
               │ 1. HTTP API (fetch + x-api-key)     │ 2. Realtime onSnapshot
               ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FIREBASE FIRESTORE                                  │
│  usage_logs · entries_cache · system_config                                 │
└──────────────▲──────────────────────────────────────▲───────────────────────┘
               │ write / update                       │ read config
               │                                      │
┌──────────────┴──────────────────────────────────────┴───────────────────────┐
│                   BACKEND (Cloudflare Worker)                               │
│  fetch router (API key)              scheduled handler (cron)               │
│           └──────────────┬─────────────────────┘                            │
│                          ▼                                                  │
│               HackerNewsScraper ──► WordCounter + Strategies                │
│                          │                                                  │
│                          ▼                                                  │
│         BaseRepository ◄── FirestoreRepository (Node/SDK)                   │
│                  ▲       FirestoreRestRepository (Workers/REST)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Layers**

| Layer | Role |
|---|---|
| Frontend | UI: filters, results, realtime audit logs, execution mode |
| Worker | HTTP API + cron trigger; orchestrates scrape → filter → persist |
| Firestore | Source of truth for cache, audit trail and system config |
| Domain services | Pure business logic (word count, strategies, HTML parsing) |

---

## SOLID principles

| Principle | How it is applied |
|---|---|
| **SRP** | `HackerNewsScraper` only parses HTML; `WordCounter` only counts words; `FirestoreRepository` / `FirestoreRestRepository` only persist data; each React component owns one UI concern. |
| **OCP** | Filters use the **Strategy pattern** (`FilterStrategy`). New filters are new classes—existing code is not modified. `NO_FILTER` was added without touching strategy classes. |
| **LSP** | Any `FilterStrategy` subclass or `BaseRepository` implementation can replace another (unit tests assert substitutability). |
| **ISP** | `BaseRepository` exposes only the four operations the app needs (`saveUsageLog`, `saveEntries`, `getSystemConfig`, `updateSystemConfig`). |
| **DIP** | Services depend on abstractions: strategies receive an injected `WordCounter`; the worker receives an injected repository; tests inject mocks. |

---

## Business rules

1. **Extraction** — first **30** rows with `tr.athing`; entity: `number`, `title`, `points` (default `0`), `comments` (default `0` for “discuss” or missing).
2. **Word count** — split on `\s+`, drop isolated symbols:  
   `"This is - a self-explained example"` → **5** words.
3. **Filters**
   - `MORE_THAN_5_WORDS_BY_COMMENTS` — titles with **> 5** words, sort **comments desc**.
   - `LESS_OR_EQUAL_5_WORDS_BY_POINTS` — titles with **≤ 5** words, sort **points desc**.
   - `NO_FILTER` — all entries in original order (added for default UI view).
4. **Audit** — each query writes to `usage_logs`: `timestamp` (ISO 8601), `filter_applied`, `results_count`, `execution_type` (`MANUAL` | `SCHEDULED` | `ORDER` | `SEARCH`), `execution_time_ms`.
5. **UI view controls (client-side)**
   - Text search filters titles (no audit log).
   - Click **Points** / **Comments** headers → sort desc (toggle) → audit `ORDER` (`Order by points` / `Order by comments`).
   - Exact word-count choice next to **Title** → audit `SEARCH` (`filter by [n] words`).
   - UI actions persist logs via `POST /api/logs`.
6. **Scheduled execution (Firestore-driven schedule)**
   - `wrangler.toml` defines a fixed base wake: `crons = ["0 * * * *"]` (every hour, UTC) — infrastructure only, never edited to change frequency.
   - Firestore `system_config` holds the real schedule: `frequency_hours` (UI options 1, 2, 3, 4, 6, 8, 12, 24) and `last_run_hour` (hour key **without minutes**, e.g. `2026-09-24T18`, UTC).
   - On every hourly wake the Worker: skips if `cron_enabled` is `false`; scrapes if `last_run_hour` is empty (first run); otherwise scrapes **only when** `current_hour − last_run_hour ≥ frequency_hours`, then writes the new `last_run_hour`.
   - Saving the Execution modal (`PUT /api/config`) also **anchors** `last_run_hour` to the current hour, restarting the countdown.
   - The scheduled audit reason is built from the stored frequency: `Scraping and save entries (each N h)`.
   - Changing the frequency is a UI/Firestore edit only — **no redeploy**.

---

## Project structure

```
/
├── backend/
│   ├── src/
│   │   ├── config/          # firebaseConfig.js, firebase.js (factory)
│   │   ├── repositories/    # BaseRepository, FirestoreRepository, FirestoreRestRepository
│   │   ├── services/        # WordCounter, HackerNewsScraper, strategies/
│   │   ├── utils/           # schedule.js (shared schedule/audit helpers)
│   │   └── worker.js        # fetch + scheduled handlers
│   ├── tests/               # Vitest unit + integration suites (see Test files)
│   ├── wrangler.toml        # Cloudflare config, cron, API_KEY var
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/      # TopBar, Modal, FilterControls, ResultsTable, …
│   │   ├── services/        # api.js, firebase.js
│   │   ├── utils/           # entriesView.js (+ entriesView.test.js)
│   │   └── App.jsx
│   └── package.json
├── README.md
├── CHECKLIST.me
├── ObjectsLibrary.me
├── install.me               # full install / deploy manual
└── testresults.me           # historical test evidence per step
```

---

## Local installation

### Prerequisites

- **Node.js 20+** and npm
- **Git**
- Network access to `news.ycombinator.com` and Firestore (integration tests / realtime)
- Two terminals (backend + frontend)

```bash
node -v    # ≥ 20
npm -v
git --version
```

### Clone

```bash
git clone https://github.com/ricardoalulema-lgtm/scropcombinator.git
cd scropcombinator
```

### 1. Backend (Cloudflare Worker, local)

```bash
cd backend
npm install
npx wrangler --version
npx wrangler dev --port 8787
```

`wrangler.toml` provides `[vars] API_KEY` for local use. Firestore credentials fall back to `src/config/firebaseConfig.js` (project `test-2eb64`).

Optional local secrets file `backend/.dev.vars` (read only by `wrangler dev`):

```bash
API_KEY=your-local-secret-key
```

### 2. Frontend (React + Vite, local)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

Optional env (defaults shown) in `frontend/.env.local`:

```bash
VITE_API_BASE_URL=http://localhost:8787
VITE_API_KEY=hn-scraper-7f3a9c2e1b8d4f6a-static
```

Restart `npm run dev` after changing env files.

### 3. Smoke check

```bash
# Worker health (requires API key)
curl -H "x-api-key: hn-scraper-7f3a9c2e1b8d4f6a-static" http://localhost:8787/

# Unauthenticated request must return 401
curl -i http://localhost:8787/api/config

# Scrape + list (expect results_count: 30)
curl -H "x-api-key: hn-scraper-7f3a9c2e1b8d4f6a-static" \
  "http://localhost:8787/api/entries?filter=NO_FILTER"
```

### 4. Full local session (quick reference)

```bash
# Terminal 1 — backend
cd scropcombinator/backend
npm install
npx wrangler dev --port 8787

# Terminal 2 — frontend
cd scropcombinator/frontend
npm install
npm run dev
# → http://localhost:5173

# Terminal 3 — quality gates (optional)
cd scropcombinator/backend && npm test
cd scropcombinator/frontend && npm run lint && npm test && npm run build
```

Stop processes with `Ctrl+C`. Detailed steps and troubleshooting: **`install.me`**.

---

## Cloudflare deployment

Production backend runs as a **Cloudflare Worker** with a **cron trigger**. Frontend is a static bundle (e.g. **Cloudflare Pages**).

### Prerequisites

- Cloudflare account (free tier is enough)
- `npx wrangler login` (from `backend/`)

### 1. Deploy the Worker

```bash
cd backend
npx wrangler login
npx wrangler deploy
```

Wrangler prints the production URL, e.g. `https://hacker-news-scraper.<account>.workers.dev`.

Redeploy after every code change:

```bash
npx wrangler deploy
```

### 2. Secrets & variables

| Mechanism | Use for | In git? |
|---|---|---|
| `[vars]` in `wrangler.toml` | Non-sensitive config (local demo key) | Yes |
| `wrangler secret` | Production `API_KEY`, Firebase overrides | **No** |

```bash
cd backend

# Strong production API key (overrides [vars] at runtime)
npx wrangler secret put API_KEY

# Optional Firebase overrides if you do not rely on firebaseConfig.js defaults
npx wrangler secret put FIREBASE_PROJECT_ID
npx wrangler secret put FIREBASE_API_KEY

npx wrangler secret list
```

Dashboard alternative: **Workers & Pages** → Worker → **Settings** → **Variables and Secrets**.

Keep frontend and Worker keys in sync: after rotating `API_KEY`, rebuild frontend with matching `VITE_API_KEY` and republish.

### 3. Cron triggers (scheduled scrapes) — simple steps

The Worker can scrape Hacker News **automatically** on a frequency you pick in the UI.  
**How it works:** Cloudflare wakes the Worker **every hour on the hour** (fixed); Firestore decides whether enough hours have passed.

#### Step A — Base trigger (already in the project)

In `backend/wrangler.toml`:

```toml
[triggers]
crons = ["0 * * * *"]
```

`0 * * * *` = wake up **once per hour at minute 0 (UTC)** — 24 wakes/day (0.024 % of the free 100k/day).

It is published with the deploy (no separate install):

```bash
cd backend
npx wrangler deploy
```

#### Step B — Confirm Cloudflare received the schedule

1. Open the [Cloudflare Dashboard](https://dash.cloudflare.com).
2. **Workers & Pages** → **`hacker-news-scraper`** → **Settings** → **Triggers**.
3. You should see `0 * * * *` (Production). If missing, run `npx wrangler deploy` again.

#### Step C — Choose the frequency in the UI (Firestore decides)

Firestore `system_config` fields:

| Field | Meaning |
|---|---|
| `frequency_hours` | How often entries must refresh (1, 2, 3, 4, 6, 8, 12 or 24) — set from the UI |
| `cron_enabled` | `true` = scheduled runs allowed; `false` = always skip |
| `last_run_hour` | Last real scrape, **hour only without minutes** (e.g. `2026-09-24T15`) |

**On every hourly wake** the Worker:

1. Reads config; if `cron_enabled` is false → skip.
2. If `last_run_hour` is empty → **scrape** (first run).
3. Else if `current_hour − last_run_hour ≥ frequency_hours` → **scrape** and save `last_run_hour = current hour`.
4. Otherwise → skip (no log).

**Saving the Execution modal** (PUT `/api/config`) also writes `last_run_hour` with the current hour (anchor after you change settings).

**Easiest way:** menu **Execution** → **Scheduled** → pick **Every N hours** → **Save**.

#### Step D — Verify it is running

1. Wait `frequency_hours`, **or** use Dashboard → **Triggers** → **Test** (test wakes may skip if frequency not elapsed).
2. App → **Logs**: row `execution_type: SCHEDULED` and reason `Scraping and save entries (each N h)`.
3. Live logs: `cd backend && npx wrangler tail`.

#### Local testing note

`npx wrangler dev` does **not** fire the cron by itself:

```bash
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
```

The first call scrapes; a second call in the same hour returns `reason: frequency_not_reached`.

| If you want… | Do this |
|---|---|
| Different frequency | UI **Execution** → Scheduled → **Every N hours** → Save (no redeploy) |
| Pause automatic runs | UI → Manual → Save (`cron_enabled: false`) |
| Resume | UI → Scheduled → Save (`cron_enabled: true`) |
| Change the hourly wake itself | Edit `crons` in `wrangler.toml` → `npx wrangler deploy` (rarely needed) |
| Timezone note | Hour keys are **UTC** |

### 4. Deploy the frontend (Cloudflare Pages)

```bash
cd frontend

export VITE_API_BASE_URL="https://hacker-news-scraper.<account>.workers.dev"
export VITE_API_KEY="<same-key-as-worker>"   # bash/zsh
# PowerShell: $env:VITE_API_BASE_URL="..."; $env:VITE_API_KEY="..."

npm run lint
npm test
npm run build                                 # → dist/

npx wrangler pages deploy dist --project-name=scropcombinator-frontend
```

Dashboard alternative: **Workers & Pages → Create → Pages** → build command `npm run build`, output `dist`, set `VITE_API_BASE_URL` and `VITE_API_KEY` under **Settings → Environment variables** *before* build.

CORS: the Worker returns `access-control-allow-origin: *`, so Pages can call the API.

### 5. Post-deploy checklist

- [ ] `npx wrangler deploy` succeeded; Worker URL recorded
- [ ] `npx wrangler secret put API_KEY` (strong key)
- [ ] Dashboard → Triggers shows base cron `0 * * * *` (hourly wake)
- [ ] UI **Execution** → Scheduled + **Every N hours** saved (`cron_enabled: true`, `frequency_hours: N`)
- [ ] Frontend built with production `VITE_API_BASE_URL` + matching `VITE_API_KEY`
- [ ] UI loads; unauthenticated API call returns 401; authenticated health returns `"status": "ok"`

More detail (troubleshooting, dashboard steps): **`install.me`**.

---

## Automated tests

Backend (from **`backend/`**):

```bash
npm test
```

Variants:

```bash
npm run test:watch          # watch mode
npm run test:firestore      # Firestore integration only
npm run test:web            # real Hacker News smoke test
npx vitest run tests/worker.test.js --reporter=verbose
```

Frontend (from **`frontend/`**):

```bash
npm run lint    # oxlint
npm test        # Vitest (entriesView suite)
npm run build   # production build
```

Historical results per step are recorded in `testresults.me`.

---

## Test files

### Backend — `backend/tests/`

| File | Type | Focus |
|---|---|---|
| `WordCounter.test.js` | Unit | Word-count rules: `\s+` split, isolated symbols excluded, `"This is - a self-explained example"` = 5, empty/null edge cases |
| `FilterStrategies.test.js` | Unit | `MORE_THAN_5_WORDS_BY_COMMENTS` / `LESS_OR_EQUAL_5_WORDS_BY_POINTS`: filtering, sort order, immutability, LSP substitutability |
| `HackerNewsScraper.test.js` | Unit | HTML parsing (mocked fetch): 30 entries from `tr.athing`, entity decode, missing score, “discuss”, “1 comment”, no comments link, HTTP error |
| `HackerNewsScraperWeb.test.js` | Integration (live web) | Real scrape of `news.ycombinator.com` → 30 JSON entries (`npm run test:web`) |
| `FirestoreRepository.test.js` | Unit | Abstract `BaseRepository` (DIP/LSP) + SDK repository: `saveUsageLog` fields, `execution_type` MANUAL/SCHEDULED/ORDER/SEARCH, invalid type rejected, `saveEntries`, `getSystemConfig`, `updateSystemConfig` |
| `FirestoreRepository.integration.test.js` | Integration (live Firestore) | Real writes/reads for entries, usage logs, system config (`npm run test:firestore`) |
| `FirestoreRestRepository.test.js` | Unit | REST repository for Workers: Firestore REST encode/decode, validation without calling API, ORDER/SEARCH accepted |
| `worker.test.js` | Unit | Router: API key auth (401/500/Bearer), CORS OPTIONS, NO_FILTER, business filters, `/api/scrape`, `/api/config`, **`POST /api/logs` (ORDER/SEARCH)**, cron `handleScheduled` |
| `schedule.test.js` | Unit | Shared schedule/audit helpers (`utils/schedule.js`): `buildSaveReason`, `currentHourKey`, `hoursBetween`, `resolveFrequencyHours`, `scheduledFrequencyLabel` |
| `ScrapeAndSave.integration.test.js` | Integration (E2E) | Scrape real HN → save `entries_cache` → audit log for MANUAL and SCHEDULED flows; SCHEDULED label read from real `system_config.frequency_hours` |

### Frontend — `frontend/src/utils/`

| File | Type | Focus |
|---|---|---|
| `entriesView.test.js` | Unit | Client view helpers: `countWords`, `filterByText`, `filterByWordCount`, `sortByField` (points/comments desc), `applyViewOptions` combination |

---

## Technical decisions

| Decision | Rationale |
|---|---|
| **Cloudflare Worker** | Spec requires serverless HTTP + cron triggers in one runtime; zero servers to manage. |
| **Two repository implementations** | The official Firebase SDK does **not** run on Cloudflare Workers (no gRPC/WebChannel). `FirestoreRepository` (SDK) is primary for Node/tests; `FirestoreRestRepository` (Firestore REST API + `fetch`) serves the Worker. Both implement `BaseRepository` (DIP). |
| **Strategy pattern for filters** | OCP: new filters without modifying existing classes; easy unit testing with injected `WordCounter`. |
| **Cheerio for scraping** | Server-side HTML parsing without a browser; fast and testable with fixture HTML. |
| **Static API key on every HTTP request** | Lightweight auth so arbitrary clients cannot GET/PUT the API; header `x-api-key` or `Authorization: Bearer`. OPTIONS (CORS preflight) is exempt. Key lives in `wrangler.toml [vars]` locally; use `wrangler secret put API_KEY` in production. |
| **Realtime via `onSnapshot`** | Audit logs and `entries_cache` update without polling; matches the architecture diagram. |
| **`NO_FILTER` default in UI** | Users see results immediately from cache; filters are opt-in. |
| **Firestore-driven schedule (hourly base wake)** | Cloudflare only accepts fixed cron expressions, so `wrangler.toml` wakes the Worker every hour (`0 * * * *`) and Firestore decides the actual frequency: `handleScheduled` compares `frequency_hours` against `last_run_hour` (hour key without minutes) and skips with `frequency_not_reached` until N hours elapse; `PUT /api/config` anchors `last_run_hour` on every save. Frequency is chosen in the UI and never requires a redeploy, and the audit label `each N h` is derived from the stored config (`utils/schedule.js`) so logs always match the user's choice. **Note:** This feature is used to provide a better user experience |
| **Vitest** | Same toolchain as Vite frontend; fast, ESM-native, good mocking. |
| **Monorepo `backend/` + `frontend/`** | Clear separation of deployables while sharing one repository and commit history. |

### UI functional improvements

Enhancements added during the UI refinement phase that are **not** part of the original spec in `Requirements.md`:

- **Sort by Points / Comments** — clickable `Points` and `Comments` table headers sort the visible results descending (toggle on/off) entirely on the client, with no refetch.
- **Text filter on titles** — case-insensitive search box above the table that narrows the current view instantly (client-side only, no audit entry, so exploratory searching does not pollute the logs).
- **ORDER audit logging** — every header sort is persisted as `execution_type: ORDER` with reason `Order by points` / `Order by comments` through `POST /api/logs`, so ordering activity is traceable like backend runs.
- **SEARCH audit logging by word count** — the exact word-count selector next to **Title** filters entries with the precise title word count and persists `execution_type: SEARCH` with reason `filter by [n] words` via `POST /api/logs`.

All four are implemented as pure helpers in `frontend/src/utils/entriesView.js` (unit-tested) and wired in `ResultsTable.jsx` / `App.jsx`.

---

## API reference

All routes (except `OPTIONS`) require `x-api-key` or `Authorization: Bearer <API_KEY>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Service info |
| `GET` | `/api/entries?filter=NO_FILTER\|MORE_THAN_5_WORDS_BY_COMMENTS\|LESS_OR_EQUAL_5_WORDS_BY_POINTS` | Scrape, filter, audit (`MANUAL`) |
| `GET` | `/api/scrape` | Scrape and save to `entries_cache` |
| `GET` | `/api/config` | Read `system_config` |
| `PUT` | `/api/config` | Merge update `system_config` (anchors `last_run_hour`) |
| `POST` | `/api/logs` | Save UI audit log (`ORDER` / `SEARCH`) |
| `OPTIONS` | `*` | CORS preflight (no API key) |

Cron (local test): `curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"`  
Production schedule: base wake `0 * * * *` (hourly), gated by `cron_enabled` + `frequency_hours` vs `last_run_hour` in Firestore.

Error codes: `400` invalid filter/body · `401` missing/invalid API key · `404` unknown route · `500` upstream/server errors (including missing server API key config).

---

## Security

- **API key** required on every non-OPTIONS request; fail-closed if not configured (`500`).
- CORS allows `content-type`, `x-api-key`, `authorization` from any origin (tighten `access-control-allow-origin` for production).
- Do not commit production secrets; prefer Cloudflare secrets over `[vars]` when deploying.

---

## Versioning

The repository uses **two complementary tag series**:

| Series | Format | Meaning |
|---|---|---|
| **Official releases** | `MAJOR.MINOR.PATCH` (e.g. `1.0.0`) | Product versions published as [GitHub Releases](../../releases) with notes. |
| **Traceability tags** | `1.x` (e.g. `1.1` … `1.15`) | One snapshot tag per commit, where `x` is the commit ordinal. History aid only — **not** product versions. |

### Release rules (SemVer)

- **MAJOR** — incompatible / breaking changes.
- **MINOR** — backwards-compatible new features.
- **PATCH** — backwards-compatible bug fixes.
- The **total number of commits** the release is built on is recorded in the release notes (e.g. *"Based on 16 commits"*), keeping the numbers clean while preserving traceability.

**First official release:** `1.0.0` — initial stable version.

### How to browse

- **On GitHub:** [Releases](../../releases) for official versions · [Tags](../../tags) for the full series.
- **Locally:** `git tag -l` · `git show 1.0.0` · `git describe --tags`.

---

## License

Private evaluation project. See commit history for incremental delivery (Steps 1–7). Full install/deploy guide: [`install.me`](install.me).
