# Level Generation Guidelines (V2)

This document defines the rules for single-player puzzle generation in PentaBlocks.
Primary invariants:

1. **Every puzzle shown to the player must be solvable.** No exceptions.
2. Difficulty must increase in a meaningful and predictable way.
3. Puzzle repetition must stay low without blocking generation.
4. Level generation must stay fast (target: <500ms per level).

> **Status legend** ✅ implemented ⏳ planned

---

## 1) Solvability Contract (Non-Negotiable)

For any level `L`:

1. ✅ The game must never present an unsolved puzzle to the player.
2. ✅ Generation runs a 3-stage pipeline: pool → live random → exhaustive brute-force.
3. ✅ The exhaustive fallback tries ALL valid piece combinations (bounded, max ~70 combos).
4. ✅ If a level config has zero solvable combinations, it cannot ship (build-time validation).

Player-facing guarantee:
- The selected level always opens with a valid, solvable puzzle.
- No "level unavailable" or fallback to a different level.

---

## 2) Level Structure

100 levels organized in 10 tiers:

| Tier | Name | Levels | Cell range | Time range | Intent |
|------|------|--------|------------|------------|--------|
| 1 | Spark | 1–10 | 8–14 | 120–180s | Learn mechanics |
| 2 | Flame | 11–20 | 12–16 | 100–140s | Stable growth |
| 3 | Ember | 21–30 | 16–18 | 85–120s | Multi-step planning |
| 4 | Blaze | 31–40 | 20–21 | 72–100s | Increasing complexity |
| 5 | Storm | 41–50 | 21–25 | 68–90s | Time pressure begins |
| 6 | Thunder | 51–60 | 24–30 | 58–80s | Tight decisions |
| 7 | Cyclone | 61–70 | 28–32 | 46–70s | High planning density |
| 8 | Titan | 71–80 | 24–35 | 38–58s | Wide grid mastery |
| 9 | Legend | 81–90 | 12–36 | 26–50s | Mixed: large + speed |
| 10 | Champion | 91–100 | 12–16 | 18–35s | Expert speedruns |

### Level config validation rules

Each level config must pass (verified for all 100 levels):

1. Cell equation: `p4×4 + p3×3 + p2×2 + p1×1 = width × height`
2. Piece limits: `p4 ≤ 7, p3 ≤ 2, p2 ≤ 1, p1 ≤ 1`
3. Uniqueness: no duplicate `(w, h, p4, p3, p2, p1)` across all levels
4. Solvability: at least one valid piece combination solves the board

---

## 3) Generation Pipeline

Generation runs in `selectSinglePlayerPuzzle()` → `initGame()`.

### Stage 1: Precomputed pool (fast, primary)

`getPrecomputedLevelPool(cfg)`:

- Seeded RNG per level: `pool:v1:${levelId}` → deterministic across sessions.
- Budget: up to 520 attempts.
- Target: 24 unique solved fingerprints.
- Keep best 12 by distance to target difficulty.
- Cache: in-memory per session.

`pickPoolCandidate()`:

- Filter out recent fingerprints.
- Sort remaining by distance to target.
- Pick randomly from top 6 band.

### Stage 2: Live random generation (fallback)

`findSolvablePieceSet()`:

- Multi-batch: up to 2 batches × 260 attempts (single) or 10 × 160 (multiplayer).
- Each solved candidate scored; novelty penalty (+12) for recent fingerprints.
- Early exit when distance ≤ acceptable or enough candidates found.

### Stage 3: Exhaustive brute-force (last resort)

`exhaustiveSolvablePieceSet()`:

- ✅ Tries ALL valid piece combinations systematically.
- C(7,p4)·C(2,p3)·C(1,p2)·C(1,p1) ≤ 70 combos → always bounded and fast.
- Picks the combination closest to target difficulty.
- Guarantees a valid puzzle if any solvable combination exists.

### Retry in initGame

If Stage 1+2+3 all fail (primary attempt), one retry with relaxed parameters:
- Increased budget: 620 attempts × 6 batches.
- Novelty penalty: 0 (any fingerprint accepted).
- Recent fallback: allowed.

If both attempts fail, the level config itself is broken (should never happen with validated configs).

```
initGame()
  └─ selectSinglePlayerPuzzle(cfg, recentHistory)
       ├─ pickPoolCandidate(cfg, {recentFingerprints})  [Stage 1]
       │    └─ getPrecomputedLevelPool(cfg)
       │         └─ analyzeKatamino(w, h, pieces)
       ├─ findSolvablePieceSet(cfg, {random, noveltyPenalty})  [Stage 2]
       │    └─ analyzeKatamino(w, h, pieces)
       └─ exhaustiveSolvablePieceSet(cfg)  [Stage 3]
            └─ analyzeKatamino(w, h, pieces)  [for each combination]
```

---

## 4) Difficulty Design

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

### Piece difficulty weights (scoring)

| Piece | Weight | Reasoning |
|-------|--------|-----------|
| I1 | 0.20 | Trivial filler |
| I2 | 0.40 | Simple filler |
| I3 | 0.65 | Limited orientations |
| O4 | 0.75 | Only 1 orientation |
| I4 | 0.90 | Only 2 orientations |
| L3 | 1.10 | 4 orientations |
| T4 | 1.20 | 4 orientations |
| J4 | 1.25 | 4 orientations |
| L4 | 1.25 | 4 orientations |
| S4 | 1.45 | Mirror-asymmetric, 4 orientations |
| Z4 | 1.45 | Mirror-asymmetric, 4 orientations |

### Tier-based piece selection weights

✅ `weightedPickWithRng()` biases which pieces appear based on level range.
Easy pieces dominate early levels; hard pieces dominate late levels.

| Piece | Lv 1–20 | Lv 21–40 | Lv 41–60 | Lv 61–80 | Lv 81–100 | Character |
|-------|---------|----------|----------|----------|-----------|-----------|
| O4 | 5.0 | 3.5 | 2.0 | 1.0 | 0.5 | Easy — strong early |
| I4 | 4.5 | 3.0 | 2.0 | 1.2 | 0.8 | Easy — strong early |
| T4 | 2.0 | 3.0 | 3.5 | 3.0 | 2.5 | Mid — balanced |
| J4 | 1.5 | 2.5 | 3.0 | 3.5 | 3.0 | Mid — late leaning |
| L4 | 1.5 | 2.5 | 3.0 | 3.5 | 3.0 | Mid — late leaning |
| S4 | 0.5 | 1.5 | 2.5 | 4.0 | 5.0 | Hard — strong late |
| Z4 | 0.5 | 1.5 | 2.5 | 4.0 | 5.0 | Hard — strong late |
| I3 | 3.0 | 2.5 | 2.0 | 1.5 | 1.0 | Filler — early bias |
| L3 | 1.0 | 1.5 | 2.0 | 2.5 | 3.0 | Filler — late bias |
| I2 | 2.0 | 2.0 | 2.0 | 2.0 | 2.0 | Flat — no bias |
| I1 | 2.0 | 2.0 | 2.0 | 2.0 | 2.0 | Flat — no bias |

### Acceptance bands

| Levels | `acceptableDistance` |
|--------|---------------------|
| 1–20 | 4.5 (wider) |
| 21–60 | 3.25 (medium) |
| 61–100 | 2.5 (tight) |

---

## 5) Anti-Memorization

1. ✅ Recent fingerprint history per user (local + cloud sync, max 36 FIFO).
2. ✅ Pool selection filters out recent fingerprints first.
3. ✅ Live generation applies novelty penalty (+12) to recent fingerprints.
4. ✅ If all pool entries are recent: live generation with penalty.
5. ✅ If live generation also fails novelty: exhaustive fallback picks any valid solution.

Novelty is best-effort. Solvability always wins over novelty.

---

## 6) Solver Performance

Implemented in `solver.ts` (`analyzeKatamino`):

| Feature | Status | Detail |
|---------|--------|--------|
| Solution cache | ✅ | `solutionCache` keyed by `w×h:sortedPieceIDs` |
| Orientation precomputation | ✅ | `getAllOrientations()` with dedup |
| Piece ordering heuristic | ✅ | Fewer orientations first, then larger pieces |
| Dead-region pruning | ✅ | `hasViableEmptyRegions()` — flood-fill + subset-sum |

### ⏳ Future enhancements

- Web Worker offloading for large boards (level 58+ can block main thread 200ms+).
- Island connectivity pruning.

---

## 7) Caching Layers

1. **Solver cache** (`solutionCache` in solver.ts) — keyed by `w×h:sortedPieceIDs`.
2. **Pool cache** (`precomputedLevelPoolCache`) — keyed by level ID, per session.
3. **Piece set cache** (`solvablePieceSetCache`) — keyed by `challenge:levelId:seed`.

All caches are in-memory and cleared on page reload.

---

## 8) Operational Thresholds

| Constant | Value | Location |
|----------|-------|----------|
| `RECENT_PUZZLE_HISTORY_LIMIT` | 36 | `App.tsx` |
| `PRECOMPUTED_POOL_SIZE` | 12 | `App.tsx` |
| `PRECOMPUTED_POOL_SOLVED_TARGET` | 24 | `App.tsx` |
| `PRECOMPUTED_POOL_MAX_ATTEMPTS` | 520 | `App.tsx` |
| `noveltyPenalty` (single player) | 12 | `selectSinglePlayerPuzzle()` |
| `noveltyPenalty` (pool pick) | 8 | `findSolvablePieceSet()` default |
| `acceptableDistance` Lv 1–20 | 4.5 | `findSolvablePieceSet()` |
| `acceptableDistance` Lv 21–60 | 3.25 | `findSolvablePieceSet()` |
| `acceptableDistance` Lv 61–100 | 2.5 | `findSolvablePieceSet()` |

---

## 9) Piece Expansion Policy (If Needed)

If progression cannot remain smooth with the current 11-piece set:

1. Add additional tri/tetromino variants first (lowest disruption).
2. If insufficient, introduce pentomino family (`p5`) for Cyclone+ tiers only.
3. Rebalance scoring and solver heuristics after each expansion.

Activation criteria:
- Frequent generation failures at specific levels.
- Repetition pressure too high despite novelty strategy.
- Difficulty curve plateaus in higher bands.

---

## 10) Telemetry

Track per level:

1. ✅ Generation source (`pool`, `live`, or `exhaustive`)
2. ✅ Attempts used
3. ✅ Solved candidates found
4. ✅ Pool size
5. ✅ Recent history size
6. ⏳ Time-to-generate
7. ⏳ Player-visible fallback events (target: zero)
