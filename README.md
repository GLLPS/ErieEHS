# GLE EHS Management Hub

Environmental Health & Safety management system for Great Lakes Environmental consulting. Manages environmental compliance and safety programs for industrial/manufacturing clients in Western New York.

## Architecture

- **`/scripts`** — Node.js scripts for Airtable setup, data import, and integrations
- **`/dashboard`** — React web dashboard connecting to Airtable API

## Setup

### 1. Airtable Base

```bash
cd scripts
cp .env.example .env
# Edit .env with your Airtable Personal Access Token
npm install
node create-airtable-schema.js
```

### 2. Data Import

Place your Excel files in the `scripts/` directory:
- `GLE_Environmental_Tracker.xlsx`
- `CSA_Tracker.xlsx`

```bash
# Preview parsed data
node parse-environmental-tracker.js --dry-run
node parse-csa-tracker.js --dry-run

# Import to Airtable
node parse-environmental-tracker.js --import
node parse-csa-tracker.js --import
```

### 3. Dashboard

```bash
cd dashboard
cp .env.example .env
# Edit .env with your Airtable PAT and Base ID
npm install
npm run dev
```

### 4. Integrations (Optional)

```bash
# BigTime client sync
node bigtime-sync.js --dry-run   # preview
node bigtime-sync.js             # run

# Asana deadline sync
node asana-sync.js --dry-run     # preview
node asana-sync.js               # run
```

## Dashboard Tabs

| Tab | Description |
|-----|-------------|
| Action Required | Unified view of overdue/upcoming items across environmental & safety |
| What's Next | Visit schedule pipeline — upcoming site visits & training |
| Client Snapshot | Everything about one client in a single integrated view |
| Training Matrix | Employee x program grid with compliance tracking |
| Portfolio Overview | High-level analytics and staff workload |

## Tech Stack

- **Frontend:** React + Vite + Tailwind CSS + Recharts
- **Backend:** Airtable (API as data layer)
- **Scripts:** Node.js
- **Integrations:** BigTime API, Asana API
