# PentaBlocks Multiplayer Roadmap

## Goal

Ship multiplayer in safe, iterative steps without destabilizing the current single-player product.

## Product Direction

- Mode: `1v1 race` (same board, same timer, fastest valid completion wins)
- First release: `asynchronous challenge link` (no realtime requirement)
- Next release: `live room` with countdown and progress feed

## Phase 1 - Async Challenge MVP (Current Focus)

### Player Flow

1. Signed-in player creates a challenge for a specific level.
2. System returns a short challenge code and share link.
3. Opponent opens link and joins challenge.
4. Both players submit final run result (won/lost, elapsed, remaining).
5. Challenge details page shows simple ranking.

Note:
- Guest participation is allowed, but any challenge that includes a guest is marked `unranked` and excluded from rating calculations.

### Backend Scope

- Add challenge tables:
  - `multiplayer_challenges`
  - `multiplayer_challenge_players`
- Add endpoints:
  - `POST /api/multiplayer/challenges`
  - `GET /api/multiplayer/challenges/:code`
  - `POST /api/multiplayer/challenges/:code/join`
  - `POST /api/multiplayer/challenges/:code/submit`
- Keep auth requirement: user must be signed in (guest/email/google all allowed).

### Frontend Scope

- Add multiplayer menu button action (remove disabled state for MVP entry).
- Add challenge create/join screen.
- Add challenge summary screen.

### Success Criteria

- Two users can complete full challenge flow with shared code.
- Submitted scores are persisted and visible.
- No regression in single-player and cloud profile.

## Phase 2 - Live Rooms (WebSocket)

- Room lifecycle: `create -> join -> ready -> countdown -> playing -> finished`
- Broadcast live progress:
  - placed pieces
  - completion percent
  - elapsed time
- Reconnect grace window (20-30s)

## Phase 3 - Competitive Layer

- Basic rating (ELO)
- Match history and recent results
- Season leaderboard
- Abuse prevention:
  - server-side sanity checks
  - min/max duration guards

## Technical Notes

- Keep PostgreSQL as source of truth.
- For Phase 2 scale-out, introduce Redis pub/sub for room events.
- Keep challenge APIs backward compatible while adding realtime transport.

## Immediate Next Tasks

1. Implement DB schema + challenge APIs (Phase 1 backend foundation).
2. Wire minimal UI for create/join and result submission.
3. Add telemetry events for challenge lifecycle.
