# Level Generation Guidelines (V2)

This document defines the new target model for single-player level generation in PentaBlocks.
Primary goals:

1. Every level must be solvable.
2. Difficulty must increase in a meaningful and predictable way.
3. Puzzle repetition must stay low without blocking generation.
4. Level generation must stay fast.

---

## 1) Target Progression Model

We use 5 main difficulty bands:

| Band | Levels | Count | Intent |
|---|---:|---:|---|
| Easy | 1-10 | 10 | Learn mechanics, low pressure |
| Moderate | 11-30 | 20 | Stable challenge growth |
| Hard | 31-60 | 30 | Multi-step planning required |
| Very Hard | 61-90 | 30 | Tight decisions and fewer forgiving layouts |
| Extreme | 91-120 | 30 | Expert-level pressure and precision |

Total planned levels in this model: **120**.

Note:
- If product scope must remain 100 levels, keep the same 5-band logic and reduce counts proportionally.
- Band names and boundaries are the source of truth for tuning and analytics.

---

## 2) Solvability Contract (Non-Negotiable)

For any level `L`:

1. The game must never present an unsolved puzzle to the player.
2. If generation for `L` fails, the system retries with relaxed novelty constraints on the same level first.
3. Fallback to another level is allowed only as an internal temporary safety path and must be tracked in telemetry.
4. Long-term target is zero player-visible fallback events.

Player-facing principle:
- The selected level should open as itself, not silently downgrade.

---

## 3) Generation Pipeline

Generation runs in two stages:

1. **Precomputed solvable pool (primary):**
   - Keep multiple solvable candidates per level.
   - Prefer candidates close to level target difficulty.
   - Filter recent fingerprints for anti-memorization.

2. **Live generation (fallback on same level):**
   - Run bounded solver attempts.
   - If no novel candidate exists, allow recent fingerprint reuse as last resort.
   - Still require a valid solver result.

Hard rule:
- Novelty is important, solvability is mandatory.

---

## 4) Difficulty Design Rules by Band

### Easy (1-10)
- Simpler shapes and forgiving board proportions.
- More time budget.
- Lower branching and clearer placement affordances.

### Moderate (11-30)
- Introduce more mixed piece interactions.
- Slightly tighter time.
- Start requiring look-ahead beyond first placement.

### Hard (31-60)
- Increase search depth and trap potential.
- Balanced board variety (not only narrow or only wide).
- Time pressure becomes meaningful.

### Very Hard (61-90)
- High planning density.
- Less forgiving piece mixes.
- Strong anti-bruteforce feel with still-fair solvability.

### Extreme (91-120)
- Expert mode.
- Strict time pressure and precision.
- Highest solver complexity targets while staying deterministic and fair.

---

## 5) Anti-Memorization Without Breaking Reliability

Use fingerprint history per player:

1. Prefer unseen fingerprints.
2. If unseen pool is exhausted, expand selection band.
3. If still blocked, allow recent fingerprint reuse for the same level.

Do not fail level generation only because novelty filtering is strict.

---

## 6) Level Configuration Safety Rules

Each level config must pass:

1. Cell equation check:
   - `p4*4 + p3*3 + p2*2 + p1*1 (+ p5*5 if enabled) == boardWidth * boardHeight`
2. Piece limits check:
   - Must not request unavailable piece counts.
3. Solvability check:
   - At least one solvable fingerprint exists.
4. Runtime budget check:
   - Generation should stay inside target latency.

Any config that fails these checks cannot ship.

---

## 7) New Piece Expansion Policy (If Needed)

If progression cannot remain smooth with current set, add new piece families in a controlled way.

Suggested order:

1. Add additional tri/tetromino variants first (lowest disruption).
2. If still insufficient, introduce pentomino family (`p5`) for Very Hard / Extreme only.
3. Rebalance scoring and solver heuristics after each expansion.

Activation criteria for adding pieces:

1. Frequent generation failures at specific levels.
2. Repetition pressure too high despite novelty strategy.
3. Difficulty curve plateaus in higher bands.

---

## 8) Telemetry Requirements

Track these per level:

1. Generation source (`pool` or `live`)
2. Attempts used
3. Solved candidates found
4. Novelty fallback usage
5. Player-visible fallback events
6. Time-to-generate

Operational target:
- Player-visible "level unavailable" should trend to near zero.

---

## 9) Acceptance Criteria for Release

A level set is release-ready only if:

1. All levels in scope are solvable.
2. Difficulty trend is monotonic by band (with minor controlled variance).
3. Generation latency stays within budget on target devices.
4. No critical fallback loops or unsolved level exposure exists.

---

## 10) Implementation Notes

Current app behavior may still include temporary same-tier fallback in some failure cases.
This document defines the **target standard**: stable solvability on the selected level with minimal visible fallback.

Next technical steps:

1. Align runtime fallback policy with this contract.
2. Tune constrained levels that cause repeated unavailability.
3. Prepare optional 120-level migration plan (or compressed 100-level equivalent).

