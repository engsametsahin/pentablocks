// Validates LEVEL_DATA against four invariants:
//   1. Cell equation:   p4*4 + p3*3 + p2*2 + p1 + p5*5 === width*height - blockedCount
//   2. Piece limits:    p4≤7, p3≤2, p2≤1, p1≤1, p5≤12 (and all ≥0)
//   3. Uniqueness:      no duplicate (w,h,p4,p3,p2,p1,p5,blocked)
//   4. Solvability:     at least one combination of pieces tiles the board
//
// Levels with p5>0 use a sampled solvability check (C(12,p5) can be large).
// Wired to `prebuild` — `npm run build` aborts if any invariant fails.
// Run standalone: `npm run validate:levels`

import { LEVEL_DATA, LEVEL_P5, LEVEL_BLOCKED } from '../src/level-data';
import { ALL_PIECES, PENTOMINOES, type Piece, type Point } from '../src/constants';

const TETROMINOES = ALL_PIECES.filter((p) => p.shape.length === 4);
const TROMINOES = ALL_PIECES.filter((p) => p.shape.length === 3);
const DOMINOES = ALL_PIECES.filter((p) => p.shape.length === 2);
const MONOMINOES = ALL_PIECES.filter((p) => p.shape.length === 1);

function rotate(s: Point[]): Point[] { return s.map((p) => ({ x: -p.y, y: p.x })); }
function flip(s: Point[]): Point[] { return s.map((p) => ({ x: -p.x, y: p.y })); }
function norm(s: Point[]): Point[] {
  const mx = Math.min(...s.map((p) => p.x));
  const my = Math.min(...s.map((p) => p.y));
  return s.map((p) => ({ x: p.x - mx, y: p.y - my })).sort((a, b) => a.x - b.x || a.y - b.y);
}
function orientations(shape: Point[]): Point[][] {
  const out: Point[][] = [];
  const seen = new Set<string>();
  let cur = shape;
  for (let f = 0; f < 2; f++) {
    for (let r = 0; r < 4; r++) {
      const n = norm(cur);
      const k = n.map((p) => `${p.x},${p.y}`).join('|');
      if (!seen.has(k)) { seen.add(k); out.push(n); }
      cur = rotate(cur);
    }
    cur = flip(cur);
  }
  return out;
}

function solve(w: number, h: number, pieces: Piece[], blockedCells?: [number, number][]): boolean {
  const blockedCount = blockedCells ? blockedCells.length : 0;
  const total = pieces.reduce((s, p) => s + p.shape.length, 0);
  if (total !== w * h - blockedCount) return false;
  const grid = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  // Pre-fill blocked cells
  if (blockedCells) {
    for (const [r, c] of blockedCells) {
      if (r >= 0 && r < h && c >= 0 && c < w) grid[r][c] = true;
    }
  }
  const ps = pieces.map((p) => ({ ...p, or: orientations(p.shape), cells: p.shape.length }))
    .sort((a, b) => (a.or.length - b.or.length) || (b.cells - a.cells) || a.id.localeCompare(b.id));
  const used = Array(ps.length).fill(false);
  const canPlace = (o: Point[], r: number, c: number) => {
    for (const p of o) {
      const nr = r + p.y; const nc = c + p.x;
      if (nr < 0 || nr >= h || nc < 0 || nc >= w || grid[nr][nc]) return false;
    }
    return true;
  };
  const place = (o: Point[], r: number, c: number, v: boolean) => {
    for (const p of o) grid[r + p.y][c + p.x] = v;
  };
  const findEmpty = (): [number, number] | null => {
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) if (!grid[r][c]) return [r, c];
    return null;
  };
  const bt = (n: number): boolean => {
    if (n === ps.length) return true;
    const e = findEmpty(); if (!e) return n === ps.length;
    const [r, c] = e;
    for (let i = 0; i < ps.length; i++) {
      if (used[i]) continue;
      for (const o of ps[i].or) {
        for (const cell of o) {
          const sr = r - cell.y; const sc = c - cell.x;
          if (canPlace(o, sr, sc)) {
            place(o, sr, sc, true); used[i] = true;
            if (bt(n + 1)) return true;
            used[i] = false; place(o, sr, sc, false);
          }
        }
      }
    }
    return false;
  };
  return bt(0);
}

function* combos<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) { yield []; return; }
  if (k > arr.length) return;
  for (let i = 0; i <= arr.length - k; i++)
    for (const r of combos(arr.slice(i + 1), k - 1)) yield [arr[i], ...r];
}

function anySolvable(w: number, h: number, p4: number, p3: number, p2: number, p1: number, p5: number, blocked?: [number, number][]): boolean {
  for (const a of combos(TETROMINOES, p4))
    for (const b of combos(TROMINOES, p3))
      for (const c of combos(DOMINOES, p2))
        for (const d of combos(MONOMINOES, p1))
          for (const e of combos(PENTOMINOES, p5))
            if (solve(w, h, [...a, ...b, ...c, ...d, ...e], blocked)) return true;
  return false;
}

function countSolvable(w: number, h: number, p4: number, p3: number, p2: number, p1: number, p5: number, blocked?: [number, number][]): number {
  let n = 0;
  for (const a of combos(TETROMINOES, p4))
    for (const b of combos(TROMINOES, p3))
      for (const c of combos(DOMINOES, p2))
        for (const d of combos(MONOMINOES, p1))
          for (const e of combos(PENTOMINOES, p5))
            if (solve(w, h, [...a, ...b, ...c, ...d, ...e], blocked)) n++;
  return n;
}

const REPORT = process.argv.includes('--report');

// Minimum solvable combinations required per level.
const MIN_COMBOS_ERROR = 2;   // levels 41+: hard error if fewer than 2 combos
const MIN_COMBOS_WARN  = 2;   // levels 1-40: warn
const MIN_COMBOS_TIER_THRESHOLD = 40;

const broken: Array<{ id: number; w: number; h: number; combo: string }> = [];
const dupes: Array<{ id: number; prev: number; key: string }> = [];
const cellMismatch: Array<{ id: number; w: number; h: number; cells: number }> = [];
const limitViolations: Array<{ id: number; combo: string }> = [];
const lowVariety: Array<{ id: number; combos: number; isError: boolean }> = [];
const seen = new Map<string, number>();

LEVEL_DATA.forEach((row, i) => {
  const [w, h, p4, p3, p2, p1] = row;
  const id = i + 1;
  const p5 = LEVEL_P5[id] ?? 0;
  const blocked = LEVEL_BLOCKED[id] as [number, number][] | undefined;
  const blockedCount = blocked ? blocked.length : 0;
  const key = `${w},${h},${p4},${p3},${p2},${p1},${p5},${blockedCount}`;
  const combo = `(${p4},${p3},${p2},${p1},p5=${p5})`;

  if (seen.has(key)) dupes.push({ id, prev: seen.get(key)!, key });
  seen.set(key, id);

  const cells = p4 * 4 + p3 * 3 + p2 * 2 + p1 + p5 * 5;
  const expected = w * h - blockedCount;
  if (cells !== expected) cellMismatch.push({ id, w, h, cells });

  if (p4 > 7 || p3 > 2 || p2 > 1 || p1 > 1 || p5 > 12 || p4 < 0 || p3 < 0 || p2 < 0 || p1 < 0 || p5 < 0) {
    limitViolations.push({ id, combo });
  }

  const n = countSolvable(w, h, p4, p3, p2, p1, p5, blocked);
  if (n === 0) {
    broken.push({ id, w, h, combo });
    console.error(`UNSOLVABLE: L${id} = [${w},${h}, ${combo}]`);
  } else {
    const isHighTier = id > MIN_COMBOS_TIER_THRESHOLD;
    const threshold = isHighTier ? MIN_COMBOS_ERROR : MIN_COMBOS_WARN;
    if (n < threshold) {
      lowVariety.push({ id, combos: n, isError: isHighTier });
      const tag = isHighTier ? 'LOW-VARIETY ERROR' : 'LOW-VARIETY WARN';
      console[isHighTier ? 'error' : 'warn'](`${tag}: L${id} = [${w},${h}, ${combo}] → only ${n} combo${n === 1 ? '' : 's'}`);
    }
  }
});

if (dupes.length) {
  console.error('\nDUPLICATES:');
  dupes.forEach((d) => console.error(`  L${d.id} duplicates L${d.prev}: ${d.key}`));
}
if (cellMismatch.length) {
  console.error('\nCELL MISMATCH:');
  cellMismatch.forEach((m) => console.error(`  L${m.id}: cells=${m.cells} but board ${m.w}x${m.h}=${m.w * m.h} (blocked: ${LEVEL_BLOCKED[m.id]?.length ?? 0})`));
}
if (limitViolations.length) {
  console.error('\nPIECE LIMIT VIOLATIONS (limits: p4≤7, p3≤2, p2≤1, p1≤1, p5≤12, all ≥0):');
  limitViolations.forEach((v) => console.error(`  L${v.id}: ${v.combo}`));
}

const varietyErrors = lowVariety.filter((v) => v.isError);
const varietyWarnings = lowVariety.filter((v) => !v.isError);

console.log(`\nTotal levels: ${LEVEL_DATA.length}`);
console.log(`Unsolvable: ${broken.length} | Duplicates: ${dupes.length} | Cell mismatches: ${cellMismatch.length} | Limit violations: ${limitViolations.length}`);
console.log(`Low-variety errors (L41+, <${MIN_COMBOS_ERROR} combos): ${varietyErrors.length} | warnings (L1-40, <${MIN_COMBOS_WARN} combos): ${varietyWarnings.length}`);

if (REPORT) {
  console.log('\n--- Per-level solvable combination count ---');
  console.log('Lvl  Board  Combo                 Solvable  Time');
  let totalCombos = 0;
  LEVEL_DATA.forEach((row, i) => {
    const [w, h, p4, p3, p2, p1, t] = row;
    const id = i + 1;
    const p5 = LEVEL_P5[id] ?? 0;
    const blocked = LEVEL_BLOCKED[id] as [number, number][] | undefined;
    const n = countSolvable(w, h, p4, p3, p2, p1, p5, blocked);
    totalCombos += n;
    const flag = n < (id > MIN_COMBOS_TIER_THRESHOLD ? MIN_COMBOS_ERROR : MIN_COMBOS_WARN) ? ' ⚠' : '';
    const p5tag = p5 > 0 ? `+p5=${p5}` : '';
    console.log(`${String(id).padStart(3)}  ${(`${w}x${h}`).padEnd(6)} (${p4},${p3},${p2},${p1})${p5tag.padEnd(8)} ${String(n).padStart(3)}      ${t}s${flag}`);
  });
  console.log(`\nTotal solvable combinations across all levels: ${totalCombos}`);
  console.log(`Average per level: ${(totalCombos / LEVEL_DATA.length).toFixed(1)}`);
}

const failures = broken.length + dupes.length + cellMismatch.length + limitViolations.length + varietyErrors.length;
if (failures > 0) {
  console.error(`\n✗ Level validation failed (${failures} issue${failures === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log('\n✓ All level configs valid.');
