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
  // Compact masks replace boards that would otherwise exceed 8 cells on one axis.
  // Coordinates use [row, column]. Every mask is validated for solvability at build time.
  28: [[0, 0], [3, 4]],
  29: [[0, 4], [3, 0]],
  44: [[0, 0]],
  55: [[0, 0]],
  56: [[0, 6]],
  57: [[3, 0]],
  61: [[0, 0], [3, 7]],
  67: [[0, 7], [3, 0]],
  68: [[0, 3], [3, 4]],
  69: [[0, 4], [3, 3]],
  72: [[0, 4]],
  73: [[4, 0]],
  74: [[4, 4]],
  75: [[3, 6]],
  76: [[0, 3]],
  77: [[3, 3]],
  80: [[0, 3], [0, 4]],
  81: [[0, 0], [0, 6], [2, 3], [4, 0], [4, 6]],
  82: [[3, 3], [3, 4]],
  83: [[0, 3], [2, 0], [2, 6], [4, 2], [4, 4]],
  84: [[0, 0], [0, 5], [5, 0], [5, 5]],
  85: [[0, 0]],
  89: [[0, 0], [0, 5], [3, 0], [3, 5]],
  97: [[0, 0], [3, 4]],
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
  [3,6, 3,1,1,1, 96],   [5,4, 4,0,1,0, 92],   [5,4, 3,2,0,0, 88],
  [6,3, 3,2,0,0, 85],
  // ── Tier 4 — Blaze (31-40): 20-21 cells ──
  [4,5, 5,0,0,0, 100],  [5,4, 5,0,0,0, 96],   [4,5, 4,1,0,1, 92],
  [4,5, 3,2,1,0, 88],   [5,4, 4,1,0,1, 85],   [5,4, 3,2,1,0, 82],
  [3,7, 5,0,0,1, 80],   [3,7, 4,1,1,0, 78],   [3,7, 3,2,1,1, 75],
  [7,3, 5,0,0,1, 72],
  // ── Tier 5 — Storm (41-50): 21-25 cells ──
  // L43/44/45 use compact layouts and varied piece mixes to avoid single-solution memorization.
  [7,3, 4,1,1,0, 90],   [7,3, 3,2,1,1, 86],   [8,3, 5,1,0,1, 82],
  [5,5, 5,1,0,1, 80],   [8,3, 4,2,1,0, 78],   [4,6, 5,1,0,1, 76],
  [4,6, 4,2,1,0, 74],   [6,4, 5,1,0,1, 72],   [5,5, 6,0,0,1, 70],
  [5,5, 5,1,1,0, 68],
  // ── Tier 6 — Thunder (51-60): 24-28 cells ──
  [6,4, 4,2,1,0, 80],   [3,8, 5,1,0,1, 76],   [3,8, 4,2,1,0, 73],
  [5,5, 4,2,1,1, 70],   [7,4, 6,1,0,0, 68],   [7,4, 6,0,1,1, 66],
  [7,4, 5,2,0,1, 64],   [4,7, 6,1,0,1, 62],   [6,5, 6,2,0,0, 60],
  [4,7, 5,2,1,0, 58],
  // ── Tier 7 — Cyclone (61-70): 28-32 cells ──
  // L61/L64/L67: original (7,0,0,0) and (7,0,1,0) configs were unsolvable
  // due to T-tetromino parity (forced T4 + even-parity board mismatch).
  [8,4, 6,2,0,0, 70],  [7,4, 6,1,0,1, 66],   [7,4, 5,2,1,0, 63],
  [6,5, 6,1,1,1, 60],  [5,6, 6,2,0,0, 57],   [5,6, 6,1,1,1, 55],
  [8,4, 6,1,1,1, 53],  [8,4, 6,2,0,0, 50],   [8,4, 6,1,1,1, 48],
  // L70: pentomino level — 4 tet + 2 tri + 2 pento (LEVEL_P5[70]=2), 4×8=32 cells
  [4,8, 4,2,0,0, 46],
  // ── Tier 8 — Titan (71-80): 24-32 cells ──
  // L72-74 use compact 5x5 masks to increase shape variety without long boards.
  [4,8, 6,2,1,0, 58],   [5,5, 4,2,1,0, 55],   [5,5, 5,1,0,1, 52],
  [5,5, 4,2,1,0, 50],   [7,4, 6,1,0,0, 48],   [7,4, 6,0,1,1, 46],
  [7,4, 5,2,0,1, 44],
  // L78: pentomino level — 4 tet + 2 tri + 2 pento (LEVEL_P5[78]=2), 8×4=32 cells
  [8,4, 4,2,0,0, 42],   [8,4, 6,2,1,0, 40],
  [8,4, 6,2,0,0, 38],
  // ── Tier 9 — Legend (81-90): compact masks and speed-oriented boards ──
  // L81-85 use irregular masks so difficulty comes from topology rather than excessive width.
  [7,5, 6,2,0,0, 35],
  [8,4, 6,1,1,1, 32],
  [7,5, 6,1,1,1, 30],
  [6,6, 6,2,1,0, 28],
  [6,5, 6,1,1,0, 38],   [6,2, 2,1,0,1, 35],
  [7,2, 3,0,1,0, 33],   [7,2, 2,2,0,0, 30],   [6,4, 4,1,0,1, 28],
  [8,2, 3,1,0,1, 26],
  // ── Tier 10 — Champion (91-100): unique combos + speedruns ──
  [6,2, 1,2,1,0, 35],   [7,2, 2,1,1,1, 32],   [8,2, 2,2,1,0, 30],
  [5,3, 3,0,1,1, 28],   [5,3, 2,2,0,1, 26],   [6,3, 3,1,1,1, 32],
  [5,4, 3,1,1,1, 30],   [3,4, 1,2,1,0, 22],   [4,3, 1,2,1,0, 20],
  [2,6, 1,2,1,0, 18],
];
