# Requirements — Architecture & Specification Document

> English translation of the original specification (`Requirements.me`, now local-only).
> Content is unchanged; presentation has been improved with tables and proper Markdown structure.

---

## 1. Project Summary & Objectives

Develop a full-stack solution that performs **web scraping of [Hacker News](https://news.ycombinator.com/)**, processing **exactly the first 30 entries**. The application will:

- Filter and sort data according to business rules based on the **word count of the title**.
- Store usage audit records in **Firebase Firestore**.
- Support two execution modes — **Manual (on-demand)** and **Scheduled (via cron)** — running on **Cloudflare Workers**.

---

## 2. Functional Requirements & Business Rules

### 2.1 Data extraction (Scraper)

Extract the first **30 entries** with the following entity structure:

| Field | Type | Description |
|---|---|---|
| `number` | Integer | Ordinal position in the list. |
| `title` | String | Original title of the post. |
| `points` | Integer | Current score; **defaults to `0`** when absent. |
| `comments` | Integer | Comment count; **defaults to `0`** when it says "discuss" or there is no comments link. |

### 2.2 Word-count logic

- Words are split **strictly on whitespace** (`\s+`).
- Isolated symbols / punctuation are **excluded**.
- Example: `"This is - a self-explained example"` → exactly **5 words**.

### 2.3 Filters & ordering (Strategies)

| # | Filter id | Condition | Ordering |
|---|---|---|---|
| 1 | `MORE_THAN_5_WORDS_BY_COMMENTS` | Title has **> 5** words | Descending by `comments` |
| 2 | `LESS_OR_EQUAL_5_WORDS_BY_POINTS` | Title has **≤ 5** words | Descending by `points` |

### 2.4 Telemetry & audit

Every query is stored in Firebase Firestore, collection **`usage_logs`**:

| Field | Description |
|---|---|
| `timestamp` | Exact date/time of the request, **ISO 8601**. |
| `filter_applied` | Identifier of the executed filter. |
| `results_count` | Number of records returned. |
| `execution_type` | `"MANUAL"` or `"SCHEDULED"`. |
| `execution_time_ms` | Processing time in milliseconds. |

---

## 3. System Architecture (Clean / Layered Architecture)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (React + Vite)                           │
│  - Filter controls, Results table, Cron frequency selector                  │
└──────────────────────┬──────────────────────────────┬───────────────────────┘
                       │ 1. Scrape / config request   │ 2. Realtime listener
                       ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FIREBASE FIRESTORE                                │
│  - Collections: `usage_logs`, `entries_cache`, `system_config`             │
└──────────────────────▲──────────────────────────────▲───────────────────────┘
                       │                              │
                       │ Updates records              │ Reads config
                       │                              │
┌──────────────────────┴──────────────────────────────┴───────────────────────┐
│                     BACKEND (Cloudflare Worker Serverless)                  │
│                                                                             │
│   ┌──────────────────────────┐   ┌──────────────────────────┐               │
│   │  API Handler (Fetch)     │   │  Cron Handler (Scheduled)│               │
│   └────────────┬─────────────┘   └──────────────┬───────────┘               │
│                └─────────────────┬──────────────┘                           │
│                                  ▼                                          │
│                        ┌──────────────────────┐                             │
│                        │  HackerNewsScraper   │ (SRP: HTML parsing)         │
│                        └──────────┬───────────┘                             │
│                                   ▼                                         │
│                        ┌──────────────────────┐                             │
│                        │ WordCounter&Filters  │ (OCP: Strategy pattern)     │
│                        └──────────┬───────────┘                             │
│                                   ▼                                         │
│                        ┌──────────────────────┐                             │
│                        │ FirestoreRepository  │ (DIP: persistence)          │
│                        └──────────────────────┘                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### SOLID principles applied

| Principle | How it is applied |
|---|---|
| **SRP** (Single Responsibility) | Each class has one task: `HackerNewsScraper` parses the DOM, `WordCounter` processes strings, `FirestoreRepository` manages the database. |
| **OCP** (Open/Closed) | Strategy pattern for filters: new filters are added as standalone classes without altering existing ones. |
| **LSP** (Liskov Substitution) | Repositories and strategies are interchangeable. |
| **ISP** (Interface Segregation) | Small, use-case-oriented interfaces. |
| **DIP** (Dependency Inversion) | Core services depend on abstractions, enabling mock injection in unit tests. |

---

## 4. Project Structure

```text
/hacker-news-scraper-app
├── /backend
│   ├── /src
│   │   ├── /domain
│   │   │   └── Entry.js
│   │   ├── /services
│   │   │   ├── HackerNewsScraper.js
│   │   │   ├── WordCounter.js
│   │   │   └── /strategies
│   │   │       ├── FilterStrategy.js
│   │   │       ├── MoreThanFiveWordsStrategy.js
│   │   │       └── LessOrEqualFiveWordsStrategy.js
│   │   ├── /repositories
│   │   │   ├── BaseRepository.js
│   │   │   ├── FirestoreRepository.js
│   │   │   └── FirestoreRestRepository.js
│   │   ├── /config
│   │   │   ├── firebaseConfig.js
│   │   │   └── firebase.js
│   │   └── worker.js
│   ├── /tests
│   │   ├── WordCounter.test.js
│   │   ├── FilterStrategies.test.js
│   │   └── HackerNewsScraper.test.js
│   ├── wrangler.toml
│   └── package.json
│
└── /frontend
    ├── /src
    │   ├── /components
    │   │   ├── TopBar.jsx
    │   │   ├── Modal.jsx
    │   │   ├── FilterControls.jsx
    │   │   ├── ResultsTable.jsx
    │   │   ├── AuditLogsTable.jsx
    │   │   └── ScheduleConfig.jsx
    │   ├── /services
    │   │   ├── api.js
    │   │   └── firebase.js
    │   └── App.jsx
    ├── package.json
    └── README.md
```

---

## 5. Step-by-Step Implementation Roadmap (Prompt Plan)

### Step 1 — Domain: word count & filters + unit tests

**Goal:** Create the pure, deterministic business logic in JavaScript, covered by automated tests with Vitest.

**Deliverables:**

- `WordCounter.js` — regex that splits on spaces and discards isolated symbols.
- `FilterStrategies.js` — implementation of the two filter/sort strategies.
- `WordCounter.test.js` and `FilterStrategies.test.js` — test cases verifying the example `"This is - a self-explained example"`.

### Step 2 — Web scraping service

**Goal:** Fetch and parse the Hacker News HTML using **cheerio**.

**Deliverables:**

- `HackerNewsScraper.js` — extracts the first **30** records, handling edge cases (missing score, missing comments).
- `HackerNewsScraper.test.js` — tests over mocked (fixture) HTML.

### Step 3 — Persistence & audit layer (Firebase)

**Goal:** Integrate Firebase Firestore to store entries and audit logs. The object must allow connecting **any** database, with Firebase as the primary one.

**Deliverables:**

- `FirestoreRepository.js` — methods to save logs (`saveUsageLog`), save cache (`saveEntries`) and read the frequency configuration.
- Firebase variables in a **separate config file** (the database already exists):

```js
const firebaseConfig = {
  apiKey: "AIzaSyCcO5oXonWAMTCcdRRa1Q-bczWCyhZdwog",
  authDomain: "test-2eb64.firebaseapp.com",
  projectId: "test-2eb64",
  storageBucket: "test-2eb64.firebasestorage.app",
  messagingSenderId: "49121312615",
  appId: "1:49121312615:web:973e681cd224fb0530b9c2"
};
```

### Step 4 — Serverless backend on Cloudflare Worker

**Goal:** Create the backend with HTTP support (on-demand) and scheduled tasks (cron trigger).

**Deliverables:**

- `worker.js` — fetch handler (manual requests) and scheduled handler (cron).
- `wrangler.toml` — Cloudflare deployment configuration with timed triggers.

### Step 5 — Frontend with React + Vite

**Goal:** Develop the graphical user interface.

**Deliverables:**

- Filter selection panel.
- Reactive results table.
- Realtime logs component connected to Firestore via `onSnapshot`.
- Execution mode selector (manual vs. scheduled frequency).

### Step 6 — AI-assisted UI improvement (refinement phase)

**Goal:** Redesign the interface to be highly user-friendly, with everything accessible in a single place and the **Results list as the main block** of the application.

**Deliverables:**

- **Top menu (`TopBar`)** with buttons that open modals: **Execution** (manual vs. scheduled frequency) and **Audit logs** (realtime table via `onSnapshot`).
- **Friendly filter and execution inputs:** radio-style chips for filters (including the `NO_FILTER` / *All entries* option as default) and a Manual/Scheduled segmented control with a frequency selector.
- **Results list as the main part of the application:** hierarchical layout, stats (entries, ms), table with scroll and sticky header.
- **Results visible by default with no filters:** realtime subscription to `entries_cache` plus a `NO_FILTER` option in the Worker.
- **Unified access:** logs and execution settings take no fixed screen space; they open from the top menu without leaving the same screen.
- **Validation:** `oxlint` with **0 errors** and a successful `vite build`.

### Step 7 — Final documentation & version control

**Goal:** Prepare the repository for evaluation.

**Deliverables:**

- Ordered, incremental commit history.
- `README.md` explaining architecture, run commands and design decisions.
- `CHECKLIST.me` with the status of all requirements and observations (e.g. static API key in the `worker.js` router).
- `ObjectsLibrary.me` with the frontend/backend object catalog (relational diagram, variables, constructors and methods).
