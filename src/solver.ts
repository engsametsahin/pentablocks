import { Point, Piece } from './constants';

export interface SolvedPiece extends Piece {
  position: Point;
  currentShape: Point[];
}

export interface SolveAnalysis {
  solution: SolvedPiece[] | null;
  searchNodes: number;
  deadRegionPrunes: number;
  cacheHit: boolean;
}

const solutionCache = new Map<string, Omit<SolveAnalysis, 'cacheHit'>>();

function clonePoints(points: Point[]) {
  return points.map((point) => ({ ...point }));
}

function cloneSolvedPieces(solution: SolvedPiece[] | null) {
  if (!solution) return null;
  return solution.map((piece) => ({
    ...piece,
    shape: clonePoints(piece.shape),
    position: { ...piece.position },
    currentShape: clonePoints(piece.currentShape),
  }));
}

function cloneSolveAnalysis(analysis: Omit<SolveAnalysis, 'cacheHit'>, cacheHit: boolean): SolveAnalysis {
  return {
    solution: cloneSolvedPieces(analysis.solution),
    searchNodes: analysis.searchNodes,
    deadRegionPrunes: analysis.deadRegionPrunes,
    cacheHit,
  };
}

function buildSolveCacheKey(width: number, height: number, pieces: Piece[]) {
  const ids = pieces.map((piece) => piece.id).sort().join(',');
  return `${width}x${height}:${ids}`;
}

/**
 * Generates all unique orientations (rotations and flips) of a piece shape.
 */
function getAllOrientations(shape: Point[]): Point[][] {
  const orientations: Point[][] = [];
  const seen = new Set<string>();

  let current = shape;
  for (let f = 0; f < 2; f++) { // Flip
    for (let r = 0; r < 4; r++) { // Rotate
      const normalized = normalizeShape(current);
      const key = normalized.map(p => `${p.x},${p.y}`).sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        orientations.push(normalized);
      }
      current = rotate(current);
    }
    current = flip(current);
  }
  return orientations;
}

function rotate(shape: Point[]): Point[] {
  return shape.map(p => ({ x: -p.y, y: p.x }));
}

function flip(shape: Point[]): Point[] {
  return shape.map(p => ({ x: -p.x, y: p.y }));
}

function normalizeShape(shape: Point[]): Point[] {
  const minX = Math.min(...shape.map(p => p.x));
  const minY = Math.min(...shape.map(p => p.y));
  return shape.map(p => ({ x: p.x - minX, y: p.y - minY })).sort((a, b) => a.x - b.x || a.y - b.y);
}

/**
 * Solves the Katamino puzzle using backtracking.
 */
export function analyzeKatamino(
  width: number,
  height: number,
  pieces: Piece[]
): SolveAnalysis {
  const cacheKey = buildSolveCacheKey(width, height, pieces);
  if (solutionCache.has(cacheKey)) {
    return cloneSolveAnalysis(solutionCache.get(cacheKey)!, true);
  }

  const grid = Array.from({ length: height }, () => Array(width).fill(false));
  const result: SolvedPiece[] = [];

  const totalCellsToFill = width * height;
  const totalPieceCells = pieces.reduce((sum, p) => sum + p.shape.length, 0);

  if (totalPieceCells !== totalCellsToFill) {
    const impossible = { solution: null, searchNodes: 0, deadRegionPrunes: 0 };
    solutionCache.set(cacheKey, impossible);
    return cloneSolveAnalysis(impossible, false);
  }

  const pieceOrientations = pieces
    .map((piece) => ({
      ...piece,
      orientations: getAllOrientations(piece.shape),
      cellCount: piece.shape.length,
    }))
    .sort((a, b) => {
      if (a.orientations.length !== b.orientations.length) {
        return a.orientations.length - b.orientations.length;
      }
      if (a.cellCount !== b.cellCount) {
        return b.cellCount - a.cellCount;
      }
      return a.id.localeCompare(b.id);
    });
  const used = Array(pieceOrientations.length).fill(false);
  let searchNodes = 0;
  let deadRegionPrunes = 0;

  function canPlace(shape: Point[], r: number, c: number): boolean {
    for (const p of shape) {
      const nr = r + p.y;
      const nc = c + p.x;
      if (nr < 0 || nr >= height || nc < 0 || nc >= width || grid[nr][nc]) {
        return false;
      }
    }
    return true;
  }

  function place(shape: Point[], r: number, c: number, val: boolean) {
    for (const p of shape) {
      grid[r + p.y][c + p.x] = val;
    }
  }

  function findNextEmpty(): [number, number] | null {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (!grid[r][c]) return [r, c];
      }
    }
    return null;
  }

  function buildReachableSums(remainingSizes: number[]) {
    const reachable = new Set<number>([0]);
    for (const size of remainingSizes) {
      const next = new Set(reachable);
      for (const existing of reachable) {
        next.add(existing + size);
      }
      reachable.clear();
      for (const value of next) {
        reachable.add(value);
      }
    }
    return reachable;
  }

  function getEmptyRegionSizes() {
    const visited = Array.from({ length: height }, () => Array(width).fill(false));
    const sizes: number[] = [];
    const directions: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (let r = 0; r < height; r += 1) {
      for (let c = 0; c < width; c += 1) {
        if (grid[r][c] || visited[r][c]) continue;
        let regionSize = 0;
        const stack: Array<[number, number]> = [[r, c]];
        visited[r][c] = true;

        while (stack.length > 0) {
          const [currentR, currentC] = stack.pop()!;
          regionSize += 1;

          for (const [dr, dc] of directions) {
            const nextR = currentR + dr;
            const nextC = currentC + dc;
            if (
              nextR < 0
              || nextR >= height
              || nextC < 0
              || nextC >= width
              || grid[nextR][nextC]
              || visited[nextR][nextC]
            ) {
              continue;
            }
            visited[nextR][nextC] = true;
            stack.push([nextR, nextC]);
          }
        }

        sizes.push(regionSize);
      }
    }

    return sizes;
  }

  function hasViableEmptyRegions() {
    const remainingSizes = pieceOrientations
      .map((piece, index) => (!used[index] ? piece.cellCount : null))
      .filter((value): value is number => value !== null);

    if (remainingSizes.length === 0) return true;

    const minRemainingSize = Math.min(...remainingSizes);
    const reachableSums = buildReachableSums(remainingSizes);

    for (const regionSize of getEmptyRegionSizes()) {
      if (regionSize < minRemainingSize) {
        deadRegionPrunes += 1;
        return false;
      }
      if (!reachableSums.has(regionSize)) {
        deadRegionPrunes += 1;
        return false;
      }
    }

    return true;
  }

  function backtrack(placedCount: number): boolean {
    searchNodes += 1;
    if (placedCount === pieceOrientations.length) return true;

    const empty = findNextEmpty();
    if (!empty) return placedCount === pieceOrientations.length;
    const [r, c] = empty;

    for (let i = 0; i < pieceOrientations.length; i++) {
      const p = pieceOrientations[i];
      if (used[i]) continue;

      for (const orientation of p.orientations) {
        for (const cell of orientation) {
          const startR = r - cell.y;
          const startC = c - cell.x;

          if (canPlace(orientation, startR, startC)) {
            place(orientation, startR, startC, true);
            used[i] = true;
            result.push({
              id: p.id,
              name: p.name,
              shape: clonePoints(p.shape),
              color: p.color,
              position: { x: startC, y: startR },
              currentShape: clonePoints(orientation),
            });

            if (hasViableEmptyRegions() && backtrack(placedCount + 1)) {
              return true;
            }

            result.pop();
            used[i] = false;
            place(orientation, startR, startC, false);
          }
        }
      }
    }
    return false;
  }

  const solved = backtrack(0) ? cloneSolvedPieces(result) : null;
  const analysis = {
    solution: solved ? cloneSolvedPieces(solved) : null,
    searchNodes,
    deadRegionPrunes,
  };
  solutionCache.set(cacheKey, analysis);
  return cloneSolveAnalysis(analysis, false);
}

export function solveKatamino(
  width: number,
  height: number,
  pieces: Piece[]
): SolvedPiece[] | null {
  return analyzeKatamino(width, height, pieces).solution;
}
