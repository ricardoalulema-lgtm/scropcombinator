# Scropcombinator — Hacker News Scraper

Full-stack solution that scrapes the **top 30 Hacker News entries**, filters and sorts them by **title word-count business rules**, audits every execution in **Firebase Firestore**, and supports **manual (on-demand)** and **scheduled (cron)** runs on **Cloudflare Workers**.

## Table of contents

- [Architecture](#architecture)
- [SOLID principles](#solid-principles)
- [Business rules](#business-rules)
- [Project structure](#project-structure)
- [Local installation](#local-installation)
- [Automated tests](#automated-tests)
- [Technical decisions](#technical-decisions)
- [API reference](#api-reference)
- [Security](#security)

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
4. **Audit** — each query writes to `usage_logs`: `timestamp` (ISO 8601), `filter_applied`, `results_count`, `execution_type` (`MANUAL` | `SCHEDULED`), `execution_time_ms`.

---

## Project structure

```
/
├── backend/
│   ├── src/
│   │   ├── config/          # firebaseConfig.js, firebase.js (factory)
│   │   ├── repositories/    # BaseRepository, FirestoreRepository, FirestoreRestRepository
│   │   ├── services/        # WordCounter, HackerNewsScraper, strategies/
│   │   └── worker.js        # fetch + scheduled handlers
│   ├── tests/               # Vitest unit + integration suites
│   ├── wrangler.toml        # Cloudflare config, cron, API_KEY var
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/      # TopBar, Modal, FilterControls, ResultsTable, …
│   │   ├── services/        # api.js, firebase.js
│   │   └── App.jsx
│   └── package.json
├── README.md
├── CHECKLIST.me
├── ObjectsLibrary.me
└── testresults.me           # historical test evidence per step
```

---

## Local installation

### Prerequisites

- Node.js 20+ and npm
- Network access to `news.ycombinator.com` and Firestore (for integration tests / realtime)

### 1. Backend (Cloudflare Worker)

```bash
cd backend
npm install
npx wrangler dev --port 8787
```

`wrangler.toml` provides `[vars] API_KEY` for local use. Firestore credentials fall back to `src/config/firebaseConfig.js` (project `test-2eb64`).

### 2. Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

Optional env (defaults shown):

```bash
# frontend/.env.local
VITE_API_BASE_URL=http://localhost:8787
VITE_API_KEY=hn-scraper-7f3a9c2e1b8d4f6a-static
```

### 3. Smoke check

```bash
# Worker health (requires API key)
curl -H "x-api-key: hn-scraper-7f3a9c2e1b8d4f6a-static" http://localhost:8787/
```

---

## Automated tests

From the **`backend/`** directory:

```bash
npm test
```

Runs **Vitest** over all suites (unit + integration), e.g.:

| Suite | Focus |
|---|---|
| `WordCounter.test.js` | Word-count rules and edge cases |
| `FilterStrategies.test.js` | Strategy filters, ordering, immutability, LSP |
| `HackerNewsScraper.test.js` | HTML parsing (mocked fetch) |
| `FirestoreRepository.test.js` | SDK repository + abstract base (DIP/LSP) |
| `FirestoreRestRepository.test.js` | REST repository encode/decode contract |
| `worker.test.js` | Router, API key auth, NO_FILTER, cron handler |
| `*.integration.test.js` | Real Firebase writes + scrape-and-save E2E |

Useful variants:

```bash
npm run test:watch          # watch mode
npm run test:firestore      # Firestore integration only
npm run test:web            # real Hacker News smoke test (appends evidence)
npx vitest run tests/worker.test.js --reporter=verbose
```

Frontend quality gates:

```bash
cd frontend
npm run lint    # oxlint
npm run build   # production build
```

Historical results per step are recorded in `testresults.me`.

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
| **Vitest** | Same toolchain as Vite frontend; fast, ESM-native, good mocking. |
| **Monorepo `backend/` + `frontend/`** | Clear separation of deployables while sharing one repository and commit history. |

---

## API reference

All routes (except `OPTIONS`) require `x-api-key` or `Authorization: Bearer <API_KEY>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Service info |
| `GET` | `/api/entries?filter=NO_FILTER\|MORE_THAN_5_WORDS_BY_COMMENTS\|LESS_OR_EQUAL_5_WORDS_BY_POINTS` | Scrape, filter, audit (`MANUAL`) |
| `GET` | `/api/scrape` | Scrape and save to `entries_cache` |
| `GET` | `/api/config` | Read `system_config` |
| `PUT` | `/api/config` | Merge update `system_config` |
| `OPTIONS` | `*` | CORS preflight (no API key) |

Cron (local test): `curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"`  
Production schedule: `0 */2 * * *` (every 2 hours), gated by `cron_enabled`.

Error codes: `400` invalid filter/body · `401` missing/invalid API key · `404` unknown route · `500` upstream/server errors (including missing server API key config).

---

## Security

- **API key** required on every non-OPTIONS request; fail-closed if not configured (`500`).
- CORS allows `content-type`, `x-api-key`, `authorization` from any origin (tighten `access-control-allow-origin` for production).
- Do not commit production secrets; prefer Cloudflare secrets over `[vars]` when deploying.

---

## License

Private evaluation project. See commit history for incremental delivery (Steps 1–7).
