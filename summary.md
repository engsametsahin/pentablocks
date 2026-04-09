# PentaBlocks Summary

## What This Project Is

PentaBlocks is a polished browser-based puzzle game built around fitting geometric pieces into timed rectangular boards. The current implementation already feels like a complete single-player game rather than a rough prototype. It includes progression, win/lose states, a solver, local stats, and a clean menu-to-level flow.

The game is positioned as:
- a web-first puzzle product
- free to play in its first public phase
- monetizable later through light ads and optional upgrades
- architected with future login and multiplayer in mind

## Current Product Features

### Gameplay

- drag-and-drop piece placement
- rotate and flip controls
- stash / return piece flow
- timed levels
- automatic win detection
- loss state with retry
- solution reveal using a built-in solver

### Progression

- 100 levels
- 10 tiers
- sequential unlock logic
- best times
- persistent local completion data

### UI and UX

- main menu
- single-player flow
- tier-based level select
- level filtering
- player stats screen
- polished overlays for generation, solution, win, and loss
- clean English UI
- consent banner and legal links
- ad-break pacing UX for monetization safety
- account panel with cloud profile state
- continue-from-last-level shortcut

## Technical Summary

### Frontend Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- motion
- lucide-react

### Core Runtime Design

The current game is mostly frontend-driven. Game logic, progression, solver interaction, and persistence all live in the client right now.

Important implementation notes:
- `src/App.tsx` contains the main app flow and most gameplay state
- `src/constants.ts` defines the piece set and transform helpers
- `src/solver.ts` provides a synchronous backtracking solver

### Current Persistence

At the moment, the project stores data locally in the browser:
- completed levels
- best times
- player stats
- consent preferences
- buffered analytics events

Cloud persistence is now available through the API for authenticated users:
- guest cloud account
- Google login account
- synchronized completed levels, best times, stats, and last played level

This is enough for a first playable version but not enough for:
- cross-device saves
- real account-based leaderboards
- persistent multiplayer identity

## Product Quality Assessment

### What Is Already Strong

- the core puzzle loop is clear and satisfying
- the game already looks cohesive
- restart/retry flow feels much better than a prototype
- progression makes the game feel substantial
- the solver creates a safety net for challenge integrity

### What Still Needs Work

- public web launch polish
- cloud persistence
- account system
- daily challenge and repeatable retention hooks
- backend groundwork for multiplayer
- analytics dashboarding and KPI reporting pipeline
- real ad provider integration (current flow is pacing-ready UX)

## Business Direction

### Near-Term Strategy

The current best strategy is:
- release on the web first
- keep the game free
- collect real usage data
- avoid aggressive monetization too early

### Monetization Direction

The current recommendation is:
- do not force ads after every single level at launch
- instead, use light interstitial pacing after multiple completions
- add rewarded options later
- consider a supporter pack or premium cosmetic/content bundles later

This approach protects retention while still leaving a path to revenue.

## Infrastructure Direction

### Hosting Decision

The current preferred hosting direction is:
- deploy on a VPS
- use Ubuntu as the server OS
- use Nginx as the web server / reverse proxy
- serve the game publicly from there

### Backend Direction

Planned backend direction:
- application API on the VPS
- PostgreSQL as the main database
- Redis later if multiplayer or real-time coordination needs it

### Why PostgreSQL

PostgreSQL is the right default for this project because it fits:
- users
- auth identities
- best scores
- progression records
- leaderboards
- match history

It is also a strong long-term fit for future multiplayer support.

## Login and Account System

Adding login is considered worthwhile because it unlocks:
- cloud save for best scores
- cross-device progression
- user identity for multiplayer
- leaderboards
- friend systems later

The likely first practical login path discussed so far is:
- Google login

This would help the game move from local-only persistence to account-based progression.

## Multiplayer Outlook

Multiplayer is not implemented yet, but it is part of the medium-term vision.

To support multiplayer well, the project will eventually need:
- authenticated users
- persistent profiles
- a backend service
- durable match records
- real-time communication
- likely Redis or in-memory coordination for active sessions

The current single-player version is a good foundation, but multiplayer will be a separate product phase, not a small toggle.

## Cost Outlook

The current low-cost infrastructure idea is:
- one VPS
- Ubuntu
- Node backend
- PostgreSQL on the same machine

This keeps costs low while still allowing:
- website hosting
- auth
- score saving
- backend API growth

The expected early-stage cost profile is small enough to make this feasible as an indie launch path.

## Recommended Execution Order

### Phase 1

- polish the public web version
- prepare deployment
- launch the free website

### Phase 2

- add analytics
- measure retention
- validate whether players replay

### Phase 3

- add login
- add backend
- add PostgreSQL
- move persistence to cloud

### Phase 4

- add daily challenge / deeper retention systems
- test light monetization

### Phase 5

- begin multiplayer architecture
- add real-time infrastructure

## Project Identity

The project is also moving toward a more professional presentation:
- possible future studio/brand naming
- public-facing web release
- stronger long-term product positioning

This matters because the game is no longer being treated as only a code experiment. It is being shaped as a real product candidate.

## Bottom Line

PentaBlocks currently stands in a very promising middle state:
- more polished than a prototype
- not yet a fully launched product
- but already strong enough to justify real deployment and infrastructure planning

The project now has a believable path from:
- local single-player puzzle game
to
- public web product
to
- account-based service
to
- multiplayer-capable game platform
