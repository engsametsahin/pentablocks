import { ALL_PIECES, PENTOMINOES, type Piece } from './constants';
import { LEVEL_BLOCKED, LEVEL_DATA, LEVEL_P5 } from './level-data';
import { analyzeKatamino } from './solver';

const POOL_SIZE = 24;
const POOL_SOLVED_TARGET = 24;
const POOL_MAX_ATTEMPTS = 520;

interface ChallengeLevelConfig {
  id: number;
  width: number;
  height: number;
  p4: number;
  p3: number;
  p2: number;
  p1: number;
  p5: number;
  blockedCells: [number, number][];
  timeSeconds: number;
}

interface PoolEntry {
  pieces: Piece[];
  fingerprint: string;
  difficultyScore: number;
  distanceToTarget: number;
}

export interface CanonicalChallengePuzzle {
  levelId: number;
  width: number;
  height: number;
  pieces: Piece[];
  blockedCells: [number, number][];
  timeLimit: number;
  fingerprint: string;
  candidatePoolSize: number;
}

const PIECE_DIFFICULTY: Record<string, number> = {
  I1: 0.2, I2: 0.4, I3: 0.65, O4: 0.75, I4: 0.9, L3: 1.1,
  T4: 1.2, J4: 1.25, L4: 1.25, S4: 1.45, Z4: 1.45,
  X5: 1.1, I5: 1.2, T5: 1.35, V5: 1.4, P5: 1.45, W5: 1.5,
  L5: 1.5, U5: 1.55, F5: 1.6, N5: 1.6, Y5: 1.6, Z5: 1.65,
};

const PIECE_TIER_WEIGHT: Record<string, [number, number, number, number, number]> = {
  O4: [5, 3.5, 2, 1, 0.5], I4: [4.5, 3, 2, 1.2, 0.8],
  T4: [2, 3, 3.5, 3, 2.5], J4: [1.5, 2.5, 3, 3.5, 3],
  L4: [1.5, 2.5, 3, 3.5, 3], S4: [0.5, 1.5, 2.5, 4, 5],
  Z4: [0.5, 1.5, 2.5, 4, 5], I3: [3, 2.5, 2, 1.5, 1],
  L3: [1, 1.5, 2, 2.5, 3], I2: [2, 2, 2, 2, 2], I1: [2, 2, 2, 2, 2],
  I5: [0, 0, 0.5, 2, 3], X5: [0, 0, 0.5, 2, 2.5],
  T5: [0, 0, 0.3, 1.5, 2.5], V5: [0, 0, 0.3, 1.5, 2.5],
  P5: [0, 0, 0.3, 1.5, 2.5], W5: [0, 0, 0.2, 1.5, 2.5],
  L5: [0, 0, 0.2, 1.5, 2.5], U5: [0, 0, 0.2, 1.5, 2.5],
  F5: [0, 0, 0.1, 1.2, 2], N5: [0, 0, 0.1, 1.2, 2],
  Y5: [0, 0, 0.1, 1.2, 2], Z5: [0, 0, 0.1, 1.2, 2],
};

const poolCache = new Map<number, PoolEntry[]>();

function clonePieces(pieces: Piece[]) {
  return pieces.map((piece) => ({
    ...piece,
    shape: piece.shape.map((point) => ({ ...point })),
  }));
}

function getLevel(levelId: number): ChallengeLevelConfig | null {
  const row = LEVEL_DATA[levelId - 1];
  if (!row) return null;
  const [rawWidth, rawHeight, p4, p3, p2, p1, timeSeconds] = row;
  const width = Math.max(rawWidth, rawHeight);
  const height = Math.min(rawWidth, rawHeight);
  return {
    id: levelId,
    width,
    height,
    p4,
    p3,
    p2,
    p1,
    p5: LEVEL_P5[levelId] ?? 0,
    blockedCells: (LEVEL_BLOCKED[levelId] ?? []).map((cell) => [...cell] as [number, number]),
    timeSeconds,
  };
}

function createSeededRng(seed: string) {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += hash << 13;
    hash ^= hash >>> 7;
    hash += hash << 3;
    hash ^= hash >>> 17;
    hash += hash << 5;
    return (hash >>> 0) / 4294967296;
  };
}

function tierIndex(levelId: number) {
  if (levelId <= 10) return 0;
  if (levelId <= 30) return 1;
  if (levelId <= 60) return 2;
  if (levelId <= 80) return 3;
  return 4;
}

function selectionWeight(pieceId: string, levelId: number) {
  return PIECE_TIER_WEIGHT[pieceId]?.[tierIndex(levelId)] ?? 1;
}

function weightedPick(pool: Piece[], count: number, levelId: number, rng: () => number) {
  if (count === 0) return [];
  const available = pool.map((piece) => ({ piece, weight: selectionWeight(piece.id, levelId) }));
  const result: Piece[] = [];
  for (let index = 0; index < count && available.length > 0; index += 1) {
    let total = available.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) {
      available.forEach((entry) => { entry.weight = 1; });
      total = available.length;
    }
    let roll = rng() * total;
    let selectedIndex = available.length - 1;
    for (let candidate = 0; candidate < available.length; candidate += 1) {
      roll -= available[candidate].weight;
      if (roll <= 0) {
        selectedIndex = candidate;
        break;
      }
    }
    result.push(available[selectedIndex].piece);
    available.splice(selectedIndex, 1);
  }
  return result;
}

function pickPieces(config: ChallengeLevelConfig, rng: () => number) {
  return [
    ...weightedPick(ALL_PIECES.filter((piece) => piece.shape.length === 4), config.p4, config.id, rng),
    ...weightedPick(ALL_PIECES.filter((piece) => piece.shape.length === 3), config.p3, config.id, rng),
    ...weightedPick(ALL_PIECES.filter((piece) => piece.shape.length === 2), config.p2, config.id, rng),
    ...weightedPick(ALL_PIECES.filter((piece) => piece.shape.length === 1), config.p1, config.id, rng),
    ...weightedPick(PENTOMINOES, config.p5, config.id, rng),
  ];
}

function fingerprint(config: ChallengeLevelConfig, pieces: Piece[]) {
  const blockedMask = [...config.blockedCells]
    .sort(([rowA, colA], [rowB, colB]) => rowA - rowB || colA - colB)
    .map(([row, col]) => `${row}:${col}`)
    .join('|');
  return `${config.id}:${config.width}x${config.height}:${blockedMask}:${pieces.map((piece) => piece.id).sort().join(',')}`;
}

function expectedDifficulty(pool: Piece[], levelId: number) {
  const total = pool.reduce((sum, piece) => sum + selectionWeight(piece.id, levelId), 0);
  if (total <= 0) return 0;
  return pool.reduce(
    (sum, piece) => sum + selectionWeight(piece.id, levelId) * (PIECE_DIFFICULTY[piece.id] ?? 1),
    0,
  ) / total;
}

function targetDifficulty(config: ChallengeLevelConfig) {
  const progress = (config.id - 1) / Math.max(1, LEVEL_DATA.length - 1);
  const areaFactor = (config.width * config.height - config.blockedCells.length) / 36;
  const bySize = (size: number) => ALL_PIECES.filter((piece) => piece.shape.length === size);
  const expectedMix =
    config.p4 * expectedDifficulty(bySize(4), config.id)
    + config.p3 * expectedDifficulty(bySize(3), config.id)
    + config.p2 * expectedDifficulty(bySize(2), config.id)
    + config.p1 * expectedDifficulty(bySize(1), config.id)
    + config.p5 * expectedDifficulty(PENTOMINOES, config.id);
  return 4 + progress * 28 + areaFactor * 4 + expectedMix * 0.35;
}

function score(config: ChallengeLevelConfig, pieces: Piece[], searchNodes: number, deadRegionPrunes: number) {
  const mix = pieces.reduce((sum, piece) => sum + (PIECE_DIFFICULTY[piece.id] ?? 1), 0);
  return mix * 1.35
    + Math.log10(searchNodes + 1) * 8.5
    + Math.log10(deadRegionPrunes + 1) * 4.2;
}

function buildPool(config: ChallengeLevelConfig) {
  const cached = poolCache.get(config.id);
  if (cached) return cached.map((entry) => ({ ...entry, pieces: clonePieces(entry.pieces) }));

  const rng = createSeededRng(`pool:v1:${config.id}`);
  const target = targetDifficulty(config);
  const solved = new Map<string, PoolEntry>();
  for (let attempt = 0; attempt < POOL_MAX_ATTEMPTS && solved.size < POOL_SOLVED_TARGET; attempt += 1) {
    const pieces = pickPieces(config, rng);
    const key = fingerprint(config, pieces);
    if (solved.has(key)) continue;
    const analysis = analyzeKatamino(config.width, config.height, pieces, config.blockedCells);
    if (!analysis.solution) continue;
    const difficultyScore = score(config, pieces, analysis.searchNodes, analysis.deadRegionPrunes);
    solved.set(key, {
      pieces: clonePieces(pieces),
      fingerprint: key,
      difficultyScore,
      distanceToTarget: Math.abs(difficultyScore - target),
    });
  }
  const entries = [...solved.values()]
    .sort((a, b) => a.distanceToTarget - b.distanceToTarget || a.fingerprint.localeCompare(b.fingerprint))
    .slice(0, POOL_SIZE);
  poolCache.set(config.id, entries.map((entry) => ({ ...entry, pieces: clonePieces(entry.pieces) })));
  return entries;
}

function findSeededFallback(config: ChallengeLevelConfig, seed: string) {
  const target = targetDifficulty(config);
  let best: PoolEntry | null = null;
  for (let batch = 0; batch < 10; batch += 1) {
    const rng = createSeededRng(`${seed}:${config.id}:batch:${batch}`);
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const pieces = pickPieces(config, rng);
      const analysis = analyzeKatamino(config.width, config.height, pieces, config.blockedCells);
      if (!analysis.solution) continue;
      const difficultyScore = score(config, pieces, analysis.searchNodes, analysis.deadRegionPrunes);
      const candidate: PoolEntry = {
        pieces: clonePieces(pieces),
        fingerprint: fingerprint(config, pieces),
        difficultyScore,
        distanceToTarget: Math.abs(difficultyScore - target),
      };
      if (!best || candidate.distanceToTarget < best.distanceToTarget) best = candidate;
      if (best.distanceToTarget <= (config.id <= 20 ? 4.5 : config.id <= 60 ? 3.25 : 2.5)) return best;
    }
  }
  return best;
}

export function generateCanonicalChallengePuzzle(levelId: number, seed: string): CanonicalChallengePuzzle | null {
  const config = getLevel(levelId);
  if (!config) return null;
  const pool = buildPool(config);
  let selected: PoolEntry | null = null;
  if (pool.length > 0) {
    const topBand = pool.slice(0, Math.min(12, pool.length));
    const rng = createSeededRng(`pool-pick:${config.id}:${seed}`);
    selected = topBand[Math.floor(rng() * topBand.length)] ?? null;
  }
  selected ??= findSeededFallback(config, seed);
  if (!selected) return null;
  return {
    levelId,
    width: config.width,
    height: config.height,
    pieces: clonePieces(selected.pieces),
    blockedCells: config.blockedCells.map((cell) => [...cell] as [number, number]),
    timeLimit: config.timeSeconds,
    fingerprint: selected.fingerprint,
    candidatePoolSize: pool.length,
  };
}
