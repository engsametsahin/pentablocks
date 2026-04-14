# Level Generation Guidelines

This document defines the rules for generating single-player puzzles in PentaBlocks.
It covers solvability, performance, anti-memorization, and difficulty progression.

> **Status legend**  ✅ implemented  ⏳ partial / planned

---

## 1) Hard Requirements

1. ✅ A puzzle must never be shown unless the solver returns a valid solution.
2. ✅ Puzzle generation must finish within a bounded budget (`PRECOMPUTED_POOL_MAX_ATTEMPTS`).
3. ✅ Level difficulty must stay inside a target band for that level (`acceptableDistance`).
4. ✅ Recent puzzle fingerprints for the same user must be avoided when possible.

If a generated candidate fails any hard requirement it is rejected.
If all candidates fail, a user-friendly error is shown and telemetry is logged (see §8).

---

## 2) Data Model

### Puzzle candidate

| Field              | Type       | Source                      |
|--------------------|------------|-----------------------------|
| `pieces`           | `Piece[]`  | shuffled from pool by size  |
| `fingerprint`      | `string`   | `buildPuzzleFingerprint()`  |
| `difficultyScore`  | `number`   | `scoreSolvedCandidate()`    |
| `distanceToTarget` | `number`   | `abs(score − target)`       |

Interface: `SolvablePoolEntry` in `App.tsx`.

### Per-user progress

| Field                        | Storage           | Limit |
|------------------------------|-------------------|-------|
| `recentPuzzleFingerprints`   | localStorage + cloud sync | 36 entries (FIFO) |
| `completedLevels`            | localStorage + cloud sync | — |
| `bestTimes`                  | localStorage + cloud sync | — |

---

## 3) Generation Pipeline

Implemented in `selectSinglePlayerPuzzle()` and called during `initGame()`.

```
1. Pool first        → getPrecomputedLevelPool(cfg)
2. Novelty filter    → remove entries matching recentPuzzleFingerprints
3. Difficulty pick   → sort by distanceToTarget, pick from top 6
4. Fallback live gen → findSolvablePieceSet() with noveltyPenalty
5. Persist           → appendRecentPuzzleFingerprint()
```

### Pool generation (`getPrecomputedLevelPool`)

- Seeded RNG per level: `pool:v1:${levelId}` → deterministic across sessions.
- Budget: up to `PRECOMPUTED_POOL_MAX_ATTEMPTS` (520) attempts.
- Target: `PRECOMPUTED_POOL_SOLVED_TARGET` (24) unique solved fingerprints.
- Keep best `PRECOMPUTED_POOL_SIZE` (12) by `distanceToTarget`.
- Cache: `precomputedLevelPoolCache` (in-memory, per session).

### Candidate selection (`pickPoolCandidate`)

- Filter out recent fingerprints.
- Sort remaining by `distanceToTarget`.
- Pick randomly from top 6 band (seeded if multiplayer, Math.random if single).

### Fallback live generation (`findSolvablePieceSet`)

- Multi-batch: up to 2 batches × 260 attempts (single) or 10 × 160 (multiplayer).
- Each solved candidate scored; novelty penalty (+12) applied to recent fingerprints.
- Early exit when `distance ≤ acceptableDistance` or `solvedCandidates ≥ max`.
- Throws if no solution found (caught by UI → error modal).

### Multiplayer path (`generateChallengePieces`)

- Seeded by challenge/room seed for deterministic piece sets.
- Tries pool first (`pickPoolCandidate` with `allowRecentFallback: true`).
- Falls back to `findSolvablePieceSet` with seeded batches.

---

## 4) Difficulty Scoring

### Target difficulty (`estimateTargetDifficulty`)

```
target = 4
       + progress × 28          // linear 0→28 across levels 1→100
       + areaFactor × 4         // (w×h) / 36
       + mixFactor × 0.35       // sum of piece difficulty weights
```

### Candidate score (`scoreSolvedCandidate`)

```
score = pieceMixScore × 1.35
      + log10(searchNodes + 1) × 8.5
      + log10(deadRegionPrunes + 1) × 4.2
      + aspectPenalty             // |width − height| × 0.12
```

### Piece difficulty weights

| Piece | Weight | Reasoning |
|-------|--------|-----------|
| I1    | 0.20   | Trivial filler |
| I2    | 0.40   | Simple filler |
| I3    | 0.65   | Limited orientations |
| O4    | 0.75   | Only 1 orientation |
| I4    | 0.90   | Only 2 orientations |
| L3    | 1.10   | 4 orientations |
| T4    | 1.20   | 4 orientations |
| J4    | 1.25   | 4 orientations |
| L4    | 1.25   | 4 orientations |
| S4    | 1.45   | Mirror-asymmetric, 4 orientations |
| Z4    | 1.45   | Mirror-asymmetric, 4 orientations |

### Acceptance bands

| Levels   | `acceptableDistance` |
|----------|---------------------|
| 1–20     | 4.5 (wider)         |
| 21–60    | 3.25 (medium)       |
| 61–100   | 2.5 (tight)         |

### ✅ Tier-based piece selection weights

Piece selection is not uniform — `weightedPickWithRng()` biases which pieces
appear based on the level range.  This ensures easy levels use simpler pieces
while hard levels favor complex ones, improving both difficulty progression
and puzzle variety.

Levels are divided into 5 weight tiers (20 levels each):

| Piece | Lv 1–20 | Lv 21–40 | Lv 41–60 | Lv 61–80 | Lv 81–100 | Character |
|-------|---------|----------|----------|----------|-----------|-----------|
| O4    | 5.0     | 3.5      | 2.0      | 1.0      | 0.5       | Easy — strong early |
| I4    | 4.5     | 3.0      | 2.0      | 1.2      | 0.8       | Easy — strong early |
| T4    | 2.0     | 3.0      | 3.5      | 3.0      | 2.5       | Mid — balanced |
| J4    | 1.5     | 2.5      | 3.0      | 3.5      | 3.0       | Mid — late leaning |
| L4    | 1.5     | 2.5      | 3.0      | 3.5      | 3.0       | Mid — late leaning |
| S4    | 0.5     | 1.5      | 2.5      | 4.0      | 5.0       | Hard — strong late |
| Z4    | 0.5     | 1.5      | 2.5      | 4.0      | 5.0       | Hard — strong late |
| I3    | 3.0     | 2.5      | 2.0      | 1.5      | 1.0       | Filler — early bias |
| L3    | 1.0     | 1.5      | 2.0      | 2.5      | 3.0       | Filler — late bias |
| I2    | 2.0     | 2.0      | 2.0      | 2.0      | 2.0       | Flat — no bias |
| I1    | 2.0     | 2.0      | 2.0      | 2.0      | 2.0       | Flat — no bias |

Selection uses weighted random without replacement (`weightedPickWithRng`),
so the same piece cannot appear twice in one puzzle. Both pool generation and
live fallback use this picker via `createChallengePiecePicker()`.

---

## 5) Anti-Memorization

1. ✅ Recent fingerprint history maintained per user (local + cloud, max 36 FIFO).
2. ✅ Pool selection filters out recent fingerprints first.
3. ✅ If all pool entries are recent: fallback live generation with `noveltyPenalty: 12`.
4. ✅ If live generation also fails novelty: allows recent as last resort.

### ⏳ Future enhancements

- Layout variation seed (stash piece order, initial orientation preference).
- Weekly/seasonal salt rotation to reduce cross-user pattern convergence.

---

## 6) Solver Performance

Implemented in `solver.ts` (`analyzeKatamino`):

| Feature                    | Status | Detail |
|----------------------------|--------|--------|
| Solution cache             | ✅     | `solutionCache` by `(w×h, sortedPieceIDs)` |
| Orientation precomputation | ✅     | `getAllOrientations()` with dedup |
| Piece ordering heuristic   | ✅     | Sort by: fewer orientations first, then larger pieces first |
| Dead-region pruning        | ✅     | `hasViableEmptyRegions()` — flood-fill + subset-sum check |

### ⏳ Future enhancements

- Web Worker offloading for large boards (level 58+ can block main thread 200ms+).
- Island connectivity pruning (reject placements that create unreachable 1-cell islands).

---

## 7) Level Authoring Rules

100 levels defined in `LEVEL_CONFIGS` (compact tuple array).

### Validation checklist

| Check                       | Tool / Method |
|-----------------------------|---------------|
| Cell count: `p4×4+p3×3+p2×2+p1×1 = w×h` | Node script (verified all 100) |
| Piece pool limits: `p4≤7, p3≤2, p2≤1, p1≤1` | Node script (verified all 100) |
| Uniqueness: no duplicate `(w,h,p4,p3,p2,p1)` | Node script (100 unique combos) |
| Pool viability: ≥1 solvable fingerprint | Runtime — pool generation always produces candidates |
| Runtime budget: generation < 2s | Empirical — most levels < 100ms |

### Tier structure

| Tier | Name      | Levels  | Cell range | Time range |
|------|-----------|---------|------------|------------|
| 1    | Spark     | 1–10    | 8–14       | 120–180s   |
| 2    | Flame     | 11–20   | 12–16      | 100–140s   |
| 3    | Ember     | 21–30   | 16–18      | 85–120s    |
| 4    | Blaze     | 31–40   | 20–21      | 72–100s    |
| 5    | Storm     | 41–50   | 21–25      | 68–90s     |
| 6    | Thunder   | 51–60   | 24–28      | 58–80s     |
| 7    | Cyclone   | 61–70   | 28–32      | 46–70s     |
| 8    | Titan     | 71–80   | 24–35      | 38–58s     |
| 9    | Legend    | 81–90   | 12–36      | 26–50s     |
| 10   | Champion  | 91–100  | 12–16      | 18–35s     |

Tiers 9–10 intentionally include smaller boards with tight timers (speed challenge).

---

## 8) Runtime Failure Policy

If `findSolvablePieceSet()` throws:

1. ✅ User sees error modal: "We could not generate a valid puzzle."
2. ✅ Telemetry logged: `puzzle_generation_failed` with level ID.
3. ⏳ Auto-retry with expanded budget (not yet implemented — user manually retries).
4. ⏳ Safe nearby-level fallback (not yet implemented).

**Invariant:** An unsolved puzzle is never shown to the user.

---

## 9) Operational Thresholds

| Constant                          | Value | Location      |
|-----------------------------------|-------|---------------|
| `RECENT_PUZZLE_HISTORY_LIMIT`     | 36    | `App.tsx`     |
| `PRECOMPUTED_POOL_SIZE`           | 12    | `App.tsx`     |
| `PRECOMPUTED_POOL_SOLVED_TARGET`  | 24    | `App.tsx`     |
| `PRECOMPUTED_POOL_MAX_ATTEMPTS`   | 520   | `App.tsx`     |
| `noveltyPenalty` (single player)  | 12    | `selectSinglePlayerPuzzle()` |
| `noveltyPenalty` (pool pick)      | 8     | `findSolvablePieceSet()` default |
| `acceptableDistance` Lv 1–20      | 4.5   | `findSolvablePieceSet()` |
| `acceptableDistance` Lv 21–60     | 3.25  | `findSolvablePieceSet()` |
| `acceptableDistance` Lv 61–100    | 2.5   | `findSolvablePieceSet()` |

Tune by telemetry after release.

---

## 10) Architecture Notes

### Function call graph

```
initGame()
  └─ selectSinglePlayerPuzzle(cfg, recentHistory)
       ├─ pickPoolCandidate(cfg, {recentFingerprints})
       │    └─ getPrecomputedLevelPool(cfg)
       │         └─ analyzeKatamino(w, h, pieces)  [solver.ts]
       └─ findSolvablePieceSet(cfg, {random, noveltyPenalty})
            └─ analyzeKatamino(w, h, pieces)

generateChallengePieces(seed, cfg)   [multiplayer path]
  ├─ pickPoolCandidate(cfg, {seed})
  └─ findSolvablePieceSet(cfg, {seed, cacheKey})
```

### Caching layers

1. **Solver cache** (`solutionCache` in solver.ts) — keyed by `w×h:sortedPieceIDs`.
2. **Pool cache** (`precomputedLevelPoolCache`) — keyed by level ID, per session.
3. **Piece set cache** (`solvablePieceSetCache`) — keyed by `challenge:levelId:seed`.

All caches are in-memory and cleared on page reload.
