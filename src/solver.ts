import { Point, Piece } from './constants';

export interface SolvedPiece extends Piece {
  position: Point;
  currentShape: Point[];
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
export function solveKatamino(
  width: number,
  height: number,
  pieces: Piece[]
): SolvedPiece[] | null {
  const grid = Array.from({ length: height }, () => Array(width).fill(false));
  const result: SolvedPiece[] = [];
  
  // Pre-calculate all orientations for each piece
  const pieceOrientations = pieces.map(p => ({
    ...p,
    orientations: getAllOrientations(p.shape)
  }));

  const totalCellsToFill = width * height;
  const totalPieceCells = pieces.reduce((sum, p) => sum + p.shape.length, 0);

  // If pieces don't have enough cells to fill the grid, it's impossible
  if (totalPieceCells !== totalCellsToFill) return null;

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

  function backtrack(pieceIdx: number): boolean {
    if (pieceIdx === pieces.length) return true;

    const empty = findNextEmpty();
    if (!empty) return pieceIdx === pieces.length;
    const [r, c] = empty;

    // Try each unused piece
    for (let i = 0; i < pieceOrientations.length; i++) {
      const p = pieceOrientations[i];
      if (result.some(res => res.id === p.id)) continue;

      for (const orientation of p.orientations) {
        for (const cell of orientation) {
          const startR = r - cell.y;
          const startC = c - cell.x;

          if (canPlace(orientation, startR, startC)) {
            place(orientation, startR, startC, true);
            result.push({
              ...p,
              position: { x: startC, y: startR },
              currentShape: orientation
            });

            if (backtrack(pieceIdx + 1)) return true;

            result.pop();
            place(orientation, startR, startC, false);
          }
        }
      }
    }
    return false;
  }

  return backtrack(0) ? result : null;
}
