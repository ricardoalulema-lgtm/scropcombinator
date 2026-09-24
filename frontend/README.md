# Frontend — Hacker News Scraper

React + Vite UI for the scropcombinator project.

## Features

- **FilterControls**: selector of the two business filters (`MORE_THAN_5_WORDS_BY_COMMENTS`, `LESS_OR_EQUAL_5_WORDS_BY_POINTS`) with run/scrape actions against the Cloudflare Worker API.
- **ResultsTable**: reactive table of filtered entries (number, title, points, comments).
- **AuditLogsTable**: realtime audit log fed by a Firestore `onSnapshot` listener on `usage_logs`.
- **ScheduleConfig**: execution mode selector (Manual vs. Scheduled) with frequency control persisted to `system_config` through the Worker API.

## Structure

```
src/
├── components/
│   ├── FilterControls.jsx
│   ├── ResultsTable.jsx
│   ├── AuditLogsTable.jsx
│   └── ScheduleConfig.jsx
├── services/
│   ├── api.js        # HTTP client for the Cloudflare Worker
│   └── firebase.js   # Firebase init + onSnapshot subscriptions
└── App.jsx
```

## Commands

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build
npm run lint
```

## Configuration

- `VITE_API_BASE_URL` (env): base URL of the Worker API. Defaults to `http://localhost:8787` (wrangler dev).
- Firebase config lives in `src/services/firebase.js` (project `test-2eb64`).
