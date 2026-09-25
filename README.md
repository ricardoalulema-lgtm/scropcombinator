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
               │ 1. HTTP API (Bearer session token)   │ 2. Realtime onSnapshot
               ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FIREBASE FIRESTORE                                  │
│  usage_logs · entries_cache · system_config                                 │
└──────────────▲──────────────────────────────────────▲───────────────────────┘
               │ write / update                       │ read config
               │                                      │
┌──────────────┴──────────────────────────────────────┴───────────────────────┐
│                   BACKEND (Cloudflare Worker)                               │
│  fetch router (session auth)          scheduled handler (cron)               │
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

### How the components work

Each deployed piece has a single responsibility and only talks through the interfaces below.

| Component | Runs on | Responsibility |
|---|---|---|
| **Frontend** (`frontend/`) | Cloudflare Pages (static bundle) | UI: filter chips, results table, Logs/Execution modals. Calls the Worker API with a short-lived **Bearer session token** fetched from `POST /api/session` (the static API key never enters the bundle); reads `usage_logs` and `entries_cache` **directly from Firestore** via `onSnapshot` (realtime, no polling). All **writes** go through the Worker API so every action is authenticated and audited. |
| **Fetch router** (`handleFetch` in `worker.js`) | Cloudflare Worker — HTTP | Issues session tokens (`POST /api/session`, rate-limited), authenticates every non-OPTIONS request (session token or legacy API key) and dispatches: `/` (service info), `/api/entries` (scrape → strategy → audit), `/api/scrape` (scrape → save cache), `/api/config` `GET`/`PUT`, `POST /api/logs`. |
| **Cron handler** (`handleScheduled` in `worker.js`) | Cloudflare Worker — cron trigger | Wakes the Worker **every hour** (`0 * * * *` from `wrangler.toml`), reads `system_config` and applies the schedule gate (`cron_enabled`, `frequency_hours` vs `last_run_hour`): scrapes and audits `SCHEDULED` only when due, otherwise skips. |
| **HackerNewsScraper** | inside the Worker | Primary source: cheerio parse of `news.ycombinator.com`; automatic fallback to the official HN API on network error / HTTP 419 / empty parse (business rule 7). Always returns the same 30-entry `Entry[]` shape. |
| **WordCounter + Strategies** | inside the Worker (pure) | Business rules: word count and the two filters; strategies receive an injected `WordCounter` (DIP) and are selected by the router at runtime. |
| **Repositories** | Node/tests → `FirestoreRepository` (SDK); Worker → `FirestoreRestRepository` (REST) | Both implement `BaseRepository` (`saveUsageLog`, `saveEntries`, `getSystemConfig`, `updateSystemConfig`). The Firebase SDK cannot run on Workers, hence the REST twin. |
| **Firestore** (project `test-2eb64`) | Google | Source of truth — three collections: |

**Firestore collections**

| Collection | Document | Content |
|---|---|---|
| `usage_logs` | auto-id | One row per execution/UI action: `timestamp`, `filter_applied`, `results_count`, `execution_type` (`MANUAL`/`SCHEDULED`/`ORDER`/`SEARCH`), `execution_time_ms` |
| `entries_cache` | `latest` | The last scraped 30 entries (default table view) |
| `system_config` | `global` | Schedule: `cron_enabled`, `frequency_hours`, `cron_expression` (label only), `last_run_hour` (UTC hour key, no minutes) |

**The two flows**

- **Manual request** — browser → `POST /api/session` (once per ~15 min, obtains `Bearer` token) → `GET /api/entries?filter=…` (+ `Authorization: Bearer <token>`) → router → scraper (HTML, API fallback) → strategy → write `usage_logs` → JSON response; the Logs and Results panels refresh in realtime through their Firestore subscriptions.
- **Scheduled run** — Cloudflare wakes the Worker hourly → `handleScheduled` → gate decides scrape vs skip → scrape → `entries_cache/latest` + `last_run_hour` + `usage_logs` (`SCHEDULED`, reason `each N h`).

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
7. **Data source fallback (dual source)** — the scraper prefers the `news.ycombinator.com` HTML source; it automatically falls back to the **official HN API** (`hacker-news.firebaseio.com/v0`) when the HTML fetch fails (network error or non-OK status such as **419**, returned because HN blocks Cloudflare IPs) **or** when the HTML parses to **0 entries** (HN changed its markup). Output shape, defaults (`points`/`comments` → `0`) and the 30-entry limit are identical from either source. If both sources fail, the request returns **500** with an error naming both causes; the used source is traceable via `lastSource` and the `[scraper] … using official HN API` log.

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
│   ├── wrangler.toml        # Cloudflare config, cron trigger
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
- Network access to `news.ycombinator.com`, `hacker-news.firebaseio.com` (fallback) and Firestore (integration tests / realtime)
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

`API_KEY` is **not** stored in `wrangler.toml` (a `[vars]` binding coexisting with the Cloudflare secret is rejected at deploy: `10053`). Local dev reads the gitignored file `backend/.dev.vars`; production reads the secret set with `wrangler secret put API_KEY`. Firestore credentials fall back to `src/config/firebaseConfig.js` (project `test-2eb64`).

Local secrets file `backend/.dev.vars` (read only by `wrangler dev`, never committed):

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

**No environment variables are needed.** There is no `.env.local` to create for local development:

- `VITE_API_BASE_URL` defaults to `http://localhost:8787` (the local `wrangler dev` Worker).
- There is no `VITE_API_KEY`: the UI requests a short-lived token from `POST /api/session` at runtime, so the static key never enters the bundle.

The only variable used by this project is `VITE_API_BASE_URL`, and only for the **production build** (Step 6), where it must point to the deployed Worker URL.

### 3. Smoke check

```bash
# Worker health (requires API key)
curl -H "x-api-key: hn-scraper-7f3a9c2e1b8d4f6a-static" http://localhost:8787/

# Unauthenticated request must return 401
curl -i http://localhost:8787/api/config

# Session token flow (no static key needed after this point)
TOKEN=$(curl -s -X POST http://localhost:8787/api/session | sed 's/.*"token":"\([^"]*\)".*/\1/')

# Scrape + list with the token (expect results_count: 30)
curl -H "Authorization: Bearer $TOKEN" \
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

Production runs on **two Cloudflare pieces**: the **Worker** (HTTP API + cron) and **Pages** (frontend). Follow the steps **in order** — what each component does is explained in [Architecture](#architecture).

| Step | What you do | Result |
|---|---|---|
| [0](#step-0--prerequisites) | Prerequisites + `wrangler login` | CLI authorized |
| [1](#step-1--review-backendwrangertoml) | Review `backend/wrangler.toml` | Name, entry, cron base trigger confirmed |
| [2](#step-2--deploy-the-worker) | `npx wrangler deploy` | Worker URL + hourly cron published |
| [3](#step-3--create-the-secrets) | `npx wrangler secret put API_KEY` | Auth enabled (401/200) |
| [4](#step-4--cron-hourly-base-wake--ui-frequency) | Verify cron + pick frequency in the UI | Scheduled runs working |
| [5](#step-5--smoke-test-the-api) | Curl the production API | `results_count: 30` |
| [6](#step-6--deploy-the-frontend-cloudflare-pages) | Build + `wrangler pages deploy` | `https://scropcombinator.pages.dev` |
| [7](#step-7--end-to-end-check) | Click through the UI | Table + realtime logs |
| [8](#step-8--post-deploy-checklist) | Checklist | Done |

### Step 0 — Prerequisites

| Need | Check / command |
|---|---|
| Node.js 20+ | `node -v` |
| Cloudflare account (free tier is enough) | https://dash.cloudflare.com |
| Code on your machine | `git clone https://github.com/ricardoalulema-lgtm/scropcombinator.git && cd scropcombinator` |
| Wrangler authenticated | `cd backend && npx wrangler login` → browser opens → **Allow** |
| Dependencies installed | `cd backend && npm install` · `cd frontend && npm install` |

### Step 1 — Review `backend/wrangler.toml`

| Key | Value | Meaning |
|---|---|---|
| `name` | `hacker-news-scraper` | Worker name → `https://hacker-news-scraper.<account>.workers.dev` |
| `main` | `src/worker.js` | Entry point: `fetch` router + `scheduled` handler |
| `compatibility_date` | `2026-09-01` | workerd runtime version pin |
| `[triggers] crons` | `["0 * * * *"]` | **Base wake**: once per hour at minute 0 (UTC) — published with every deploy |

Two things this file deliberately does **not** contain:

- **No `[vars] API_KEY`.** The key exists only as a Cloudflare **secret** (production) and in the gitignored `backend/.dev.vars` (local dev). A `[vars]` binding with the same name as an existing secret is **rejected at deploy** (`10053`).
- **No Firebase credentials.** They default to `src/config/firebaseConfig.js` (project `test-2eb64`); add secrets only to override them.

### Step 2 — Deploy the Worker

```bash
cd backend
npx wrangler deploy
```

Expected output:

```
Uploaded hacker-news-scraper (…)
Deployed hacker-news-scraper triggers (…)
  https://hacker-news-scraper.<account>.workers.dev
  schedule: 0 * * * *
```

- **Record the URL** — it becomes `VITE_API_BASE_URL` for the frontend (this project: `https://hacker-news-scraper.ricardoalulema.workers.dev`).
- Right after this first deploy, before Step 3, every request returns **500** `API key is not configured on the server`. That is expected: the router is **fail-closed** until the secret exists.
- Run the same command after every code change; the cron from `wrangler.toml` is republished automatically.

### Step 3 — Create the secrets

| Where | Name | Used by |
|---|---|---|
| Cloudflare **secret** (encrypted, never in git) | `API_KEY` | Worker router — every request must present it |
| Cloudflare secret (optional) | `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` | Only to override `firebaseConfig.js` defaults (normally not needed) |
| `backend/.dev.vars` (gitignored, local only) | `API_KEY` | `npx wrangler dev` on your machine |

```bash
cd backend

# paste a strong random value (32+ chars) when prompted
npx wrangler secret put API_KEY

# verify
npx wrangler secret list
# → [ { "name": "API_KEY", "type": "secret_text" } ]

# optional Firebase overrides (project test-2eb64 is the default)
npx wrangler secret put FIREBASE_PROJECT_ID
npx wrangler secret put FIREBASE_API_KEY
```

Dashboard alternative: **Workers & Pages** → `hacker-news-scraper` → **Settings** → **Variables and Secrets** → *Add* → **Secret** → name `API_KEY` → paste value → Save.

Notes:

- Secrets apply **immediately** — no redeploy needed (redeploy only when the code changed).
- **No frontend rebuild on rotation:** the UI never sees `API_KEY`; it holds only short-lived session tokens (≤ 15 min), so after rotating the secret the next `POST /api/session` picks it up automatically.
- Never print or commit the value; `npx wrangler secret list` only shows names, not values.

### Step 4 — Cron: hourly base wake + UI frequency

Cloudflare only accepts **fixed** cron expressions, so the design is: the Worker wakes **every hour**, and **Firestore decides** whether N hours have already passed (details in [Architecture](#architecture)).

#### Step 4.1 — Base trigger (already in the project)

```toml
# backend/wrangler.toml
[triggers]
crons = ["0 * * * *"]   # wake at minute 0 of every hour, UTC — 24 wakes/day
```

There is **no separate install**: the cron ships with `npx wrangler deploy` from Step 2.

#### Step 4.2 — Confirm Cloudflare received the schedule

1. Open the [Cloudflare Dashboard](https://dash.cloudflare.com).
2. **Workers & Pages** → **`hacker-news-scraper`** → **Settings** → **Triggers**.
3. You should see `0 * * * *` under Production triggers. If missing, run `npx wrangler deploy` again.

#### Step 4.3 — Choose the frequency in the UI (writes Firestore)

Menu **Execution** → **Scheduled** → pick **Every N hours** (1, 2, 3, 4, 6, 8, 12 or 24) → **Save**.

That `PUT /api/config` writes `system_config/global` and anchors `last_run_hour` to the current UTC hour:

| Field | Meaning |
|---|---|
| `cron_enabled` | `true` = scheduled runs allowed; `false` = always skip |
| `frequency_hours` | How often entries must refresh (the value you picked) |
| `last_run_hour` | Last real scrape / anchor, **hour only without minutes** (e.g. `2026-09-24T15`, UTC) |
| `cron_expression` | Human-readable label only — the runtime gate uses `frequency_hours` + `last_run_hour` |

#### Step 4.4 — What happens on every hourly wake

1. Reads `system_config`; `cron_enabled: false` → **skip**.
2. `last_run_hour` empty → **scrape** (first run).
3. `current_hour − last_run_hour ≥ frequency_hours` → **scrape**, save `last_run_hour = current hour`, audit `SCHEDULED`.
4. Otherwise → **skip** (`reason: frequency_not_reached`, no log).

Changing the frequency later is a UI/Firestore edit only — **no redeploy**.

#### Step 4.5 — Verify it is running

- App → **Logs** modal: a row with `execution_type: SCHEDULED` and reason `Scraping and save entries (each N h)`.
- Live logs: `cd backend && npx wrangler tail` → look for `[scheduled] { skipped: false, entries_count: 30, … }`.
- Dashboard → **Triggers** → **Test** (a test wake may legitimately return `frequency_not_reached` if the frequency has not elapsed).

**Local testing note:** `npx wrangler dev` does **not** fire the cron by itself:

```bash
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
# first call scrapes; a second call in the same hour → frequency_not_reached
```

| If you want… | Do this |
|---|---|
| Different frequency | UI **Execution** → Scheduled → **Every N hours** → Save (no redeploy) |
| Pause automatic runs | UI → **Manual** → Save (`cron_enabled: false`) |
| Resume | UI → **Scheduled** → Save (`cron_enabled: true`) |
| Change the hourly wake itself | Edit `crons` in `wrangler.toml` → `npx wrangler deploy` (rarely needed) |
| Timezone | All hour keys and cron evaluations are **UTC** |
| Free-plan budget | 24 wakes/day ≈ 0.024 % of the 100k requests/day limit |

### Step 5 — Smoke-test the API

```bash
WORKER="https://hacker-news-scraper.<account>.workers.dev"
KEY="<value-you-pasted-in-step-3>"

curl -H "x-api-key: $KEY" "$WORKER/"
# → { "service": "hacker-news-scraper", "status": "ok", … }

curl -i "$WORKER/api/entries"
# → HTTP 401 Unauthorized (fail-closed without credentials)

# Session flow: exchange nothing for a 15-min token, then call the API with it
TOKEN=$(curl -s -X POST "$WORKER/api/session" | sed 's/.*"token":"\([^"]*\)".*/\1/')

curl -H "Authorization: Bearer $TOKEN" "$WORKER/api/entries?filter=NO_FILTER"
# → "results_count": 30

curl -H "x-api-key: $KEY" "$WORKER/api/scrape"
# → "entries_count": 30, "doc_id": "latest"
```

> If the Worker logs `[scraper] HTML source unavailable (… 419 …); using official HN API`, that is the documented fallback (business rule 7): HN blocks Cloudflare IPs, so production reads the official HN API. The response shape and `results_count: 30` are unchanged.

### Step 6 — Deploy the frontend (Cloudflare Pages)

`VITE_*` values are **baked into the bundle at build time**, so set them **before** `npm run build`.

bash/zsh:

```bash
cd frontend
export VITE_API_BASE_URL="https://hacker-news-scraper.<account>.workers.dev"
```

PowerShell:

```powershell
cd frontend
$env:VITE_API_BASE_URL="https://hacker-news-scraper.<account>.workers.dev"
```

Then lint, test, build and publish:

```bash
npm run lint
npm test
npm run build        # → dist/

npx wrangler pages deploy dist --project-name=scropcombinator
```

- The first run creates the Pages project `scropcombinator` → **`https://scropcombinator.pages.dev`**; later runs publish a new deployment to the same URL.
- Dashboard alternative: **Workers & Pages → Create → Pages** → build command `npm run build`, output directory `dist`, and define `VITE_API_BASE_URL` under **Settings → Environment variables** (Production **and** Preview) *before* the first build.
- CORS: the Worker answers with `access-control-allow-origin: *`, so the Pages domain can call the API.

### Step 7 — End-to-end check

1. Open **https://scropcombinator.pages.dev** (or your Pages URL).
2. **Load all** → the table shows **30 rows**; switch filters → results update.
3. Menu **Logs** → rows appear in realtime (`MANUAL` entries).
4. Menu **Execution** → **Scheduled** → **Every N hours** → **Save**.
5. After N hours (or Dashboard → Triggers → **Test**): a new `SCHEDULED` log row with reason `Scraping and save entries (each N h)`.

### Step 8 — Post-deploy checklist

- [ ] `npx wrangler deploy` succeeded; Worker URL recorded
- [ ] `npx wrangler secret list` shows `API_KEY`; unauthenticated call returns **401**; authenticated health returns `"status": "ok"`
- [ ] `wrangler.toml` contains **no** `[vars]` (collision with the secret → deploy error `10053`)
- [ ] Dashboard → Triggers shows base cron `0 * * * *`
- [ ] UI **Execution** → **Scheduled** + **Every N hours** saved (`cron_enabled: true`, `frequency_hours: N`)
- [ ] `/api/entries?filter=NO_FILTER` returns `results_count: 30`
- [ ] Frontend built with production `VITE_API_BASE_URL`, published to Pages (**no API key** in the bundle)
- [ ] `POST /api/session` returns a token; `GET /api/entries` with `Authorization: Bearer <token>` returns `results_count: 30`
- [ ] UI loads 30 rows; Logs modal updates in realtime

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
| `HackerNewsScraper.test.js` | Unit | HTML parsing (mocked fetch): 30 entries from `tr.athing`, entity decode, missing score, “discuss”, “1 comment”, no comments link, HTTP error — plus **HN API fallback**: all 3 triggers (419, network error, 0 entries), field mapping/defaults, skipped items renumbering, combined error when both sources fail |
| `HackerNewsScraperWeb.test.js` | Integration (live web) | Real scrape of `news.ycombinator.com` → 30 JSON entries (`npm run test:web`) |
| `FirestoreRepository.test.js` | Unit | Abstract `BaseRepository` (DIP/LSP) + SDK repository: `saveUsageLog` fields, `execution_type` MANUAL/SCHEDULED/ORDER/SEARCH, invalid type rejected, `saveEntries`, `getSystemConfig`, `updateSystemConfig` |
| `FirestoreRepository.integration.test.js` | Integration (live Firestore) | Real writes/reads for entries, usage logs, system config (`npm run test:firestore`) |
| `FirestoreRestRepository.test.js` | Unit | REST repository for Workers: Firestore REST encode/decode, validation without calling API, ORDER/SEARCH accepted |
| `worker.test.js` | Unit | Router: API key auth (401/500/Bearer), **session tokens** (`POST /api/session` 200/429, Bearer valid/expired/tampered, fail-closed 500, legacy key), CORS OPTIONS, NO_FILTER, business filters, `/api/scrape`, `/api/config`, **`POST /api/logs` (ORDER/SEARCH)**, cron `handleScheduled` |
| `sessionToken.test.js` | Unit | HMAC session tokens (`utils/sessionToken.js`): token shape `<expiry>.<64-hex>`, TTL 900 s, verify fresh, reject expired/forged expiry/tampered signature/wrong secret/malformed credentials |
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
| **Official HN API fallback** | Cloudflare Worker IPs are blocked by `news.ycombinator.com` (HTTP **419 "Sorry"**) and markup changes would silently yield 0 entries, so `scrape()` keeps cheerio as primary and falls back to `hacker-news.firebaseio.com/v0` (`topstories` + `item/<id>`, 31 subrequests — free limit is 50) on network error, non-OK status, or an empty parse; field mapping is `score → points`, `descendants → comments` (default `0`). Both sources failing → combined **500** error. |
| **Session tokens instead of a browser-held API key** | A `VITE_*` variable is compiled into the public bundle, so embedding the API key would expose it to anyone with DevTools. The Worker now issues short-lived HMAC-SHA256 bearer tokens from `POST /api/session` (TTL 15 min, signed with the server-only secret, rate-limited 60/min/IP via a `[[ratelimits]]` binding); the browser keeps the token in memory and renews it before expiry. The static key still works (`x-api-key` / `Bearer <API_KEY>`) for scripts and backwards compatibility, and exists only in the gitignored `backend/.dev.vars` (local `wrangler dev`) and as the Cloudflare secret `API_KEY` (production) — never in `wrangler.toml`, where a `[vars]` binding colliding with the secret is rejected at deploy (`10053`). |
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

All routes (except `OPTIONS` and `POST /api/session`) require credentials:
`Authorization: Bearer <session token>` (recommended) or the legacy
`x-api-key: <API_KEY>` / `Authorization: Bearer <API_KEY>`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/session` | **No auth.** Issue a short-lived bearer token `{ token, token_type, expires_in, expires_at }`; rate-limited 60 req/min per IP (`429` when exceeded) |
| `GET` | `/` | Service info |
| `GET` | `/api/entries?filter=NO_FILTER\|MORE_THAN_5_WORDS_BY_COMMENTS\|LESS_OR_EQUAL_5_WORDS_BY_POINTS` | Scrape, filter, audit (`MANUAL`) |
| `GET` | `/api/scrape` | Scrape and save to `entries_cache` |
| `GET` | `/api/config` | Read `system_config` |
| `PUT` | `/api/config` | Merge update `system_config` (anchors `last_run_hour`) |
| `POST` | `/api/logs` | Save UI audit log (`ORDER` / `SEARCH`) |
| `OPTIONS` | `*` | CORS preflight (no credentials) |

Cron (local test): `curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"`  
Production schedule: base wake `0 * * * *` (hourly), gated by `cron_enabled` + `frequency_hours` vs `last_run_hour` in Firestore.

Error codes: `400` invalid filter/body · `401` missing/invalid credentials · `404` unknown route · `429` session rate limit exceeded · `500` upstream/server errors (including missing server API key config).

---

## Security

- **Short-lived bearer tokens.** The static API key is never sent by the browser: the client calls `POST /api/session` (unauthenticated entry point) and receives an HMAC-SHA256 token valid for 15 minutes, renewed 60 s before expiry and retried once on `401`. Signature and expiry are verified server-side in constant time.
- **Rate limiting** on `POST /api/session` (`[[ratelimits]]` → 60 req/min per IP) so tokens cannot be farmed.
- **Fail-closed**: every non-OPTIONS request requires credentials; a server without `API_KEY` answers `500` and cannot mint tokens. Legacy `x-api-key` / `Bearer <API_KEY>` still accepted for scripts.
- CORS allows `content-type`, `x-api-key`, `authorization` from any origin (`access-control-allow-origin: *`). Restricting the origin is deliberately out of scope: the token, not the header, is the real gate; `*` only permits preflighted reads.
- Production `API_KEY` lives **only** as a Cloudflare secret; local dev uses the gitignored `backend/.dev.vars`. Never put it in `wrangler.toml` (`[vars]` colliding with an existing secret fails the deploy with `10053`) and never commit it.

---

## Versioning

The repository uses **two complementary tag series**:

| Series | Format | Meaning |
|---|---|---|
| **Official releases** | `MAJOR.MINOR.PATCH` (e.g. `1.0.0`) | Product versions published as [GitHub Releases](../../releases) with notes. |
| **Traceability tags** | `1.x` (e.g. `1.1`, `1.2`, … — one per commit) | One snapshot tag per commit, where `x` is the commit ordinal. History aid only — **not** product versions. |

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
