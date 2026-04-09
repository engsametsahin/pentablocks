# PentaBlocks

PentaBlocks is a browser-based puzzle game built with React, TypeScript, and Vite. Players place geometric block pieces into timed rectangular boards, progressing through tiered levels while chasing faster clear times.

The project is currently in a strong pre-launch state:
- playable single-player core
- 100 levels across 10 tiers
- local progression and best times
- stats screen
- built-in puzzle solver
- web-first release direction
- launch-readiness telemetry and policy layers

## Current Features

- Drag-and-drop piece placement
- Rotate, flip, and stash controls
- Mouse and touch support
- Timer-based gameplay
- Win / loss / retry flow
- Level progression with unlocks
- Best time tracking
- Player stats tracking
- Solver-backed solution reveal
- Session-level analytics events
- Global client error tracking hooks
- Consent banner for analytics/ad preferences
- Ad-break pacing logic (first session ad-free, then every 3 wins)

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- motion
- lucide-react

## Run Locally

Prerequisites:
- Node.js
- PostgreSQL (for account and cloud save API)

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Start the API server (new terminal):

```bash
npm run server:dev
```

Default local addresses:
- Frontend: `http://localhost:3020`
- API: `http://localhost:8787`

Build for production:

```bash
npm run build
```

Run type checks:

```bash
npm run lint
```

## Project Structure

```text
src/
|-- App.tsx
|-- constants.ts
|-- solver.ts
|-- main.tsx
|-- index.css
`-- lib/
    |-- analytics.ts
    |-- errorTracking.ts
    `-- utils.ts
public/
|-- privacy.html
`-- terms.html
DEPLOY_RUNBOOK.md
```

## Environment Variables

Copy `.env.example` and set values as needed:

- `VITE_SITE_URL`
- `VITE_API_BASE_URL`
- `VITE_GOOGLE_CLIENT_ID` (for Google login button)
- `VITE_ANALYTICS_ENDPOINT` (optional)
- `VITE_ERROR_REPORT_ENDPOINT` (optional)
- `VITE_ANALYTICS_DEBUG` (optional)
- `API_PORT`
- `APP_ORIGIN`
- `DATABASE_URL`
- `GOOGLE_CLIENT_ID` (backend token verification)

## Accounts and Cloud Save

This project now includes:
- Guest cloud login
- Email/password login
- Google login (when client id is configured)
- Server-side session cookies
- Cloud persistence for:
  - completed levels
  - best times
  - player stats
  - last played level

Backend files:
- `server/index.mjs` (API)
- `server/db.mjs` (PostgreSQL pool + schema init)
- `server/sql/init.sql` (tables)

## Current Product Direction

PentaBlocks is being developed as:
- a web-first puzzle game
- free to play in its first public release
- lightly monetized later, after retention validation
- architected with future login, cloud save, and multiplayer support in mind

## Planned Infrastructure Direction

The current preferred deployment path is:
- VPS hosting
- Ubuntu Server
- Nginx
- backend API
- PostgreSQL for persistent player data
- Redis later if multiplayer or real-time systems require it

## Documentation

- [project_context.md](G:/Proje/Katamino/project_context.md)
- [summary.md](G:/Proje/Katamino/summary.md)
- [MONETIZATION_ROADMAP.md](G:/Proje/Katamino/MONETIZATION_ROADMAP.md)

## Status

PentaBlocks is no longer just a prototype. It is already a polished single-player puzzle game and is now moving toward:
- public web launch
- account system
- cloud-backed scores and progression
- analytics
- long-term multiplayer support
