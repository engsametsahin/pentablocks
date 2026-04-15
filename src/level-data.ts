// Single source of truth for level configurations.
// Format: [width, height, p4, p3, p2, p1, timeSeconds]
// Validated by scripts/validate-levels.ts (runs as `prebuild`).
export type LevelDataRow = [number, number, number, number, number, number, number];

// Pentomino piece count overrides per level (levelId → p5 count).
// Levels listed here use p5 pentominoes in addition to (or instead of) some
// regular pieces. The base tuple still carries p4/p3/p2/p1; p5 is additive.
// Cell equation: p4*4 + p3*3 + p2*2 + p1*1 + p5*5 === width * height - blockedCount
export const LEVEL_P5: Record<number, number> = {
  70: 2,  // 4×8 board: 4 tet + 2 tri + 2 pento = 16+6+10=32 ✓
  78: 2,  // 8×4 board: 4 tet + 2 tri + 2 pento = 16+6+10=32 ✓
};

// Blocked cell coordinates per level: { [levelId]: [[row, col], ...] }
// Blocked cells are visually void and cannot be filled by pieces.
// Cell equation uses: width*height - blocked.length as total fillable area.
export const LEVEL_BLOCKED: Record<number, [number, number][]> = {
  // Example irregular grid: level 99 uses a 5×5 board with 4 corner cells blocked
  // forming a plus-like shape with 21 fillable cells.
  // 99: [[0,0],[0,4],[4,0],[4,4]]  — reserved for future use
};

export const LEVEL_DATA: LevelDataRow[] = [
  // ── Tier 1 — Spark (1-10): 8-14 cells ──
  [2,4, 2,0,0,0, 180],  [3,3, 2,0,0,1, 170],  [2,5, 2,0,1,0, 160],
  [2,5, 1,2,0,0, 150],  [3,4, 3,0,0,0, 145],  [4,3, 3,0,0,0, 140],
  [2,6, 3,0,0,0, 135],  [3,4, 2,1,0,1, 130],  [2,7, 3,0,1,0, 125],
  [2,7, 2,2,0,0, 120],
  // ── Tier 2 — Flame (11-20): 12-16 cells ──
  [4,3, 2,1,0,1, 140],  [2,6, 2,1,0,1, 135],  [2,7, 2,1,1,1, 130],
  [3,5, 3,1,0,0, 125],  [5,3, 3,1,0,0, 122],  [3,5, 3,0,1,1, 118],
  [3,5, 2,2,0,1, 114],  [4,4, 4,0,0,0, 110],  [4,4, 3,1,0,1, 106],
  [4,4, 2,2,1,0, 100],
  // ── Tier 3 — Ember (21-30): 16-18 cells ──
  [2,8, 4,0,0,0, 120],  [2,8, 3,1,0,1, 116],  [2,8, 2,2,1,0, 112],
  [3,6, 4,0,1,0, 108],  [3,6, 3,2,0,0, 104],  [6,3, 4,0,1,0, 100],
  [3,6, 3,1,1,1, 96],   [2,9, 4,0,1,0, 92],   [2,9, 3,2,0,0, 88],
  [6,3, 3,2,0,0, 85],
  // ── Tier 4 — Blaze (31-40): 20-21 cells ──
  [4,5, 5,0,0,0, 100],  [5,4, 5,0,0,0, 96],   [4,5, 4,1,0,1, 92],
  [4,5, 3,2,1,0, 88],   [5,4, 4,1,0,1, 85],   [5,4, 3,2,1,0, 82],
  [3,7, 5,0,0,1, 80],   [3,7, 4,1,1,0, 78],   [3,7, 3,2,1,1, 75],
  [7,3, 5,0,0,1, 72],
  // ── Tier 5 — Storm (41-50): 21-25 cells ──
  // L43/44/45: original (6,0,0,0) configs had only 1 solvable combo → fully memorizable.
  // Replaced with 2×12 / 12×2 narrow boards that yield 35-41 combos.
  [7,3, 4,1,1,0, 90],   [7,3, 3,2,1,1, 86],   [2,12, 5,1,0,1, 82],
  [12,2, 5,1,0,1, 80],  [2,12, 4,2,1,0, 78],  [4,6, 5,1,0,1, 76],
  [4,6, 4,2,1,0, 74],   [6,4, 5,1,0,1, 72],   [5,5, 6,0,0,1, 70],
  [5,5, 5,1,1,0, 68],
  // ── Tier 6 — Thunder (51-60): 24-28 cells ──
  [6,4, 4,2,1,0, 80],   [3,8, 5,1,0,1, 76],   [3,8, 4,2,1,0, 73],
  [5,5, 4,2,1,1, 70],   [3,9, 6,1,0,0, 68],   [3,9, 6,0,1,1, 66],
  [3,9, 5,2,0,1, 64],   [4,7, 6,1,0,1, 62],   [3,10, 6,2,0,0, 60],
  [4,7, 5,2,1,0, 58],
  // ── Tier 7 — Cyclone (61-70): 28-32 cells ──
  // L61/L64/L67: original (7,0,0,0) and (7,0,1,0) configs were unsolvable
  // due to T-tetromino parity (forced T4 + even-parity board mismatch).
  [10,3, 6,2,0,0, 70], [7,4, 6,1,0,1, 66],   [7,4, 5,2,1,0, 63],
  [3,10, 6,1,1,1, 60], [5,6, 6,2,0,0, 57],   [5,6, 6,1,1,1, 55],
  [10,3, 6,1,1,1, 53], [6,5, 6,2,0,0, 50],   [6,5, 6,1,1,1, 48],
  // L70: pentomino level — 4 tet + 2 tri + 2 pento (LEVEL_P5[70]=2), 4×8=32 cells
  [4,8, 4,2,0,0, 46],
  // ── Tier 8 — Titan (71-80): 24-32 cells ──
  // L72: original [8,3, 6,0,0,0] had 1 combo → replaced with 12×2 (35 combos).
  [4,8, 6,2,1,0, 58],   [12,2, 4,2,1,0, 55],  [8,3, 5,1,0,1, 52],
  [8,3, 4,2,1,0, 50],   [9,3, 6,1,0,0, 48],   [9,3, 6,0,1,1, 46],
  [9,3, 5,2,0,1, 44],
  // L78: pentomino level — 4 tet + 2 tri + 2 pento (LEVEL_P5[78]=2), 8×4=32 cells
  [8,4, 4,2,0,0, 42],   [8,4, 6,2,1,0, 40],
  [2,15, 6,2,0,0, 38],  // L80: was [5,7,7,2,0,1] 1-combo → 2×15 6 combos
  // ── Tier 9 — Legend (81-90): narrow + flat grids ──
  // L81-84: original 35-36 cell configs were single-combo (all 7 tetrominoes + both trominoes forced).
  // Replaced with narrow 2×n boards that have meaningful piece variation.
  [15,2, 6,2,0,0, 35],  // L81: 6 combos
  [2,15, 6,1,1,1, 32],  // L82: 14 combos
  [15,2, 6,1,1,1, 30],  // L83: 14 combos
  [2,16, 6,2,1,0, 28],  // L84: 7 combos
  [6,2, 3,0,0,0, 38],   [6,2, 2,1,0,1, 35],
  [7,2, 3,0,1,0, 33],   [7,2, 2,2,0,0, 30],   [10,2, 4,1,0,1, 28],  // L89: was [8,2,4,0,0,0] 1-combo → 10×2 65 combos
  [8,2, 3,1,0,1, 26],
  // ── Tier 10 — Champion (91-100): unique combos + speedruns ──
  [6,2, 1,2,1,0, 35],   [7,2, 2,1,1,1, 32],   [8,2, 2,2,1,0, 30],
  [5,3, 3,0,1,1, 28],   [5,3, 2,2,0,1, 26],   [6,3, 3,1,1,1, 32],
  [2,9, 3,1,1,1, 30],   [3,4, 1,2,1,0, 22],   [4,3, 1,2,1,0, 20],
  [2,6, 1,2,1,0, 18],
];
