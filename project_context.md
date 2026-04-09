# PentaBlocks Project Context

## Overview

PentaBlocks is a browser-based puzzle game built with React, TypeScript, and Vite. The core loop is based on placing polyomino-like pieces into a rectangular grid within a time limit. The project currently presents itself as a polished single-player puzzle game with progression, level tiers, solver support, and local persistent stats.

The current product direction is:
- launch on the web first
- keep the game free to play at first
- validate retention before aggressive monetization
- prepare the architecture for login, cloud persistence, and future multiplayer

## Current Product State

The game currently includes:
- main menu
- single-player entry flow
- stats screen
- level select with tier navigation and filtering
- 100 handcrafted level configurations
- drag-and-drop gameplay for mouse and touch
- piece rotation, flip, and stash controls
- timer-based win/lose loop
- local best times and completion tracking
- built-in solver with solution reveal flow
- session analytics event tracking hooks
- global client error tracking hooks
- consent banner for analytics/ad preference
- ad-break pacing guardrail (first session ad-free)
- guest/google account panel
- cloud save sync for progress and stats

### Current Screens

- `menu`
- `levelSelect`
- `game`
- `stats`

### Current UX Notes

- the game is now fully English-facing
- retry and restart flows were recently fixed
- solution reveal no longer loops back into the `Time's Up` modal
- lightweight toast feedback exists and is currently kept minimal, mainly for special events such as new best times

## Tech Stack

| Layer | Technology |
|---|---|
| UI | React 19 |
| Language | TypeScript |
| Build Tool | Vite 6 |
| Styling | Tailwind CSS 4 |
| Animation | `motion` |
| Icons | `lucide-react` |
| Utility | `clsx`, `tailwind-merge` |
| Existing backend dependency | `express` |

## Key Files

```text
PentaBlocks/
|-- src/
|   |-- App.tsx
|   |-- constants.ts
|   |-- solver.ts
|   |-- main.tsx
|   |-- index.css
|   `-- lib/
|       |-- analytics.ts
|       |-- errorTracking.ts
|       `-- utils.ts
|-- public/
|   |-- privacy.html
|   `-- terms.html
|-- server/
|   |-- index.mjs
|   |-- db.mjs
|   `-- sql/
|       `-- init.sql
|-- project_context.md
|-- MONETIZATION_ROADMAP.md
|-- DEPLOY_RUNBOOK.md
|-- AUTH_SETUP.md
|-- README.md
|-- package.json
|-- vite.config.ts
`-- tsconfig.json
```

### Responsibilities

- `src/App.tsx`
  Main application flow, screens, local progression, local stats, and gameplay state.
- `src/constants.ts`
  Piece definitions and rotation/flip helpers.
- `src/solver.ts`
  Backtracking-based synchronous puzzle solver.
- `src/lib/analytics.ts`
  Local-buffered analytics tracking with optional endpoint forwarding.
- `src/lib/errorTracking.ts`
  Global runtime error and unhandled promise rejection tracking.
- `server/index.mjs`
  Express API for auth/session and cloud progress sync.
- `server/sql/init.sql`
  PostgreSQL schema for users, sessions, and user progress.
- `DEPLOY_RUNBOOK.md`
  Deployment, rollback, and backup procedures for VPS release flow.
- `MONETIZATION_ROADMAP.md`
  Product and monetization direction for web-first launch.

## Gameplay Model

### Core Rules

- the player drags pieces from stash to board
- pieces can be rotated and flipped
- all required pieces must fit inside the target board
- the board must be fully filled without overlap
- the player must finish before the timer expires

### Progression

- 100 levels
- 10 tiers
- each level unlocks the next one
- completion and best times are stored in `localStorage`

### Piece Pool

- tetrominoes
- trominoes
- domino
- monomino

## Important State and Persistence

Current persistence is local only:
- completed levels
- best times
- player stats
- consent state
- analytics event buffer

### Stored Player Stats

- games started
- wins
- losses
- restarts
- hints used
- total play seconds

## Current Architecture Constraints

### Solver

The solver is synchronous and runs on the main thread. This is acceptable for the current version, but it may become a performance concern if:
- larger puzzle sets are added
- daily challenge generation becomes heavier
- the game is moved to lower-powered mobile devices

### Backend

There is no active production backend yet.

The project already includes `express` as a dependency, but:
- API now exists for local development
- PostgreSQL schema is included
- auth flow exists (guest + Google login)
- cloud save sync exists for core progress data

## Product Direction Agreed So Far

### Launch Strategy

- launch on a public website first
- keep the game free to play initially
- use ads carefully, not aggressively
- measure retention before increasing monetization

### Hosting Direction

The preferred hosting direction is now:
- VPS-based deployment instead of a platform-only deployment
- Ubuntu on the VPS
- Nginx in front
- application backend on the server

### Data Direction

Planned database direction:
- PostgreSQL as the main database
- Redis later if needed for matchmaking, sessions, or live multiplayer state

### Auth Direction

Planned direction:
- add login for cloud best scores and progression
- support future multiplayer and friend/leaderboard features
- Google login was discussed as a practical early option

## Recommended Near-Term Roadmap

### Immediate Technical Priorities

1. Prepare production web deployment
2. Add a real backend service
3. Add PostgreSQL schema for users and scores
4. Add authentication
5. Move best scores and progression from local-only to cloud-backed storage

### Immediate Product Priorities

1. Web launch polish
2. Daily challenge and replay hooks
3. Light monetization experiments
4. Login and cloud persistence transition

## Planned Deployment Shape

Initial expected production setup:
- 1 VPS
- Ubuntu Server
- Nginx
- Node.js backend
- PostgreSQL on the same VPS
- frontend served publicly over HTTPS

Later additions:
- Redis
- WebSocket or real-time game server layer
- separate DB or managed infrastructure if scale grows

## Multiplayer Direction

Multiplayer is not implemented yet, but the project is being discussed with future support in mind.

Likely requirements:
- user accounts
- persistent profiles
- match records
- matchmaking
- real-time state synchronization
- anti-cheat and validation rules

Likely long-term architecture:
- PostgreSQL for durable records
- Redis or in-memory state for active matches
- real-time server layer for live games

## Monetization Direction

Current working strategy:
- free web-first release
- no aggressive ad wall
- likely interstitial pacing only after several completed levels
- optional rewarded ads later
- supporter pack or premium cosmetic/content options later

See also:
- `MONETIZATION_ROADMAP.md`

## Open Questions

- final studio/brand name is not decided yet
- auth provider is not finalized
- backend framework is not finalized
- multiplayer mode design is not finalized
- analytics backend destination is not selected yet
- ad provider is not selected yet

## Development Commands

```bash
npm install
npm run dev
npm run build
npm run lint
```

## Current Status Summary

PentaBlocks is no longer just a toy prototype. It is currently a polished single-player web puzzle game with a credible path toward:
- public web launch
- account system
- cloud persistence
- monetization experiments
- future multiplayer expansion
