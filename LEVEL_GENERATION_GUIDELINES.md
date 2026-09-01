# PentaBlocks Level Generation Guidelines (V3)

This document is the contract for single-player, Arena, multiplayer, web, and native mobile puzzle generation.

## 1. Non-Negotiable Rules

1. Every puzzle shown to a player must be solvable.
2. Both board axes must be between 2 and 8 cells.
3. Piece area must equal the number of playable board cells.
4. Blocked cells must be unique, in bounds, and leave one connected playable region.
5. A level may not duplicate another level's full configuration.
6. Web and mobile must use the same level data and canonical generator.
7. Solvability takes priority over novelty. A repeated valid puzzle is better than a broken puzzle.

These rules are enforced by `npm run validate:levels`, which is also run by `prebuild`.

## 2. Source Of Truth

- Level dimensions, piece counts, timers, and blocked masks: `src/level-data.ts`
- Runtime puzzle selection: `src/App.tsx`
- Shared deterministic generation for Arena, multiplayer, and mobile: `src/challenge-puzzle.ts`
- Solver and solver cache: `src/solver.ts`
- Build-time validation: `scripts/validate-levels.ts`

Do not add another platform-specific copy of the level table. Native mobile imports the shared data and canonical generator.

## 3. Difficulty Bands

| Band | Levels | Primary intent |
|---|---:|---|
| Easy | 1-10 | Learn placement, rotation, and flipping |
| Moderate | 11-30 | Introduce planning and mixed pieces |
| Hard | 31-60 | Increase branching and tighter layouts |
| Very Hard | 61-80 | High planning density and stronger time pressure |
| Extreme | 81-100 | Difficult piece mixes, compact masks, and speed |

Difficulty must not be created by making a board excessively long or tall.

## 4. Board Geometry

### Hard limits

- Minimum axis: 2 cells
- Maximum axis: 8 cells
- No `10x2`, `3x10`, `2x15`, or similar boards may ship.

### Preferred shape

- Preferred aspect ratio after tutorial levels: at most `2.5:1`.
- Wider tutorial boards are allowed when they teach a clear mechanic.
- Aspect-ratio exceptions produce validator warnings and should be reviewed visually on phone and desktop.

### Compact replacements

When a piece set needs more area than a visually balanced rectangle provides, use a compact rectangle plus blocked cells. Example:

```text
Long board:       10x3 = 30 cells
Compact board:     8x4 = 32 cells
Blocked mask:       2 cells
Playable area:     30 cells
```

Blocked coordinates use `[row, column]`.

## 5. Solvability Contract

For each level:

```text
p4*4 + p3*3 + p2*2 + p1 + p5*5
  == width*height - blockedCellCount
```

The build validator checks:

1. Cell equation
2. Piece-count limits
3. Board geometry
4. Blocked-mask validity and connectivity
5. Full configuration uniqueness, including blocked coordinates
6. At least one solver-confirmed piece combination
7. Minimum variety for later levels

If any hard rule fails, production build must stop.

## 6. Generation Pipeline

### Stage 1: Solved pool

- Deterministic per-level RNG: `pool:v1:<levelId>`
- Up to 520 candidate attempts
- Target: 24 unique solved fingerprints
- Keep up to 24 candidates closest to the target difficulty
- Choose from the best 12 candidates after recent-history filtering

### Stage 2: Live solved generation

If the pool cannot provide a suitable non-recent candidate, generate additional piece sets and verify each with `analyzeKatamino`.

### Stage 3: Exhaustive fallback

Try every valid bounded piece combination and choose a solvable result. Player-facing generation failure should remain zero.

## 7. Difficulty Model

Board length is not difficulty. The candidate score uses:

```text
score = pieceMixScore * 1.35
      + log10(searchNodes + 1) * 8.5
      + log10(deadRegionPrunes + 1) * 4.2
```

Meaningful difficulty signals:

- Solver search nodes
- Dead-region pruning count
- Piece orientation complexity
- Piece interaction and constrained placement
- Playable area and density
- Blocked-mask topology
- Timer pressure

Do not add an aspect-ratio bonus or penalty to difficulty scoring.

## 8. Anti-Memorization

A puzzle fingerprint contains:

```text
levelId + dimensions + sorted blocked mask + sorted piece IDs
```

Current protections:

- Up to 24 solved candidates per level
- Random selection from a 12-candidate quality band
- Recent fingerprint history, up to 36 entries
- Novelty penalty during live generation
- Seeded deterministic selection for shared matches

A different hidden solver placement is not a different puzzle when dimensions, mask, and pieces are unchanged.

### Future mask variants

For levels that still repeat too often, add a validated list of mask variants rather than random unverified blockers. Every variant must:

1. Keep the same playable area
2. Stay connected
3. Pass solver validation
4. Have a distinct fingerprint
5. Be visually balanced on mobile

### Future fixed pieces

Fixed starting pieces can add difficulty later, but they require coordinated support in:

- Solver input and cache keys
- Web and mobile rendering
- Arena and multiplayer payloads
- Puzzle fingerprints
- Build-time validation

Do not represent a fixed piece as a blocked cell; they have different gameplay semantics.

## 9. Cross-Platform Rules

1. Shared matches use one seed and one canonical puzzle payload.
2. Mobile converts canonical `[row, column]` blocked coordinates to `{x: column, y: row}`.
3. Platform UI may scale or rotate the presentation, but may not change pieces, mask, timer, or solution rules.
4. Local mobile single-player also uses the canonical generator with a fresh seed.

## 10. Release Checklist

Run before publishing level-generation changes:

```powershell
npm run validate:levels
npm run lint
npm run build
Set-Location mobile
npx tsc --noEmit
```

Manual checks:

- Open one level from each difficulty band on desktop and phone.
- Verify compact boards fit without scrolling.
- Verify blocked cells match on web and mobile.
- Verify Arena opponents receive identical dimensions, pieces, mask, and timer.
- Use Show Solution on changed levels.
- Confirm no level falls back to a previous level.

## 11. Telemetry To Track

- Generation source: pool, live, or exhaustive
- Generation duration
- Attempts used
- Pool size
- Recent-history size
- Level completion rate
- Average solve time and DNF rate
- Hint and Show Solution usage
- Puzzle fingerprint repetition rate

Use telemetry to tune difficulty bands. Do not infer difficulty from board dimensions alone.
