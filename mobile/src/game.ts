export type Point = { x: number; y: number };

export interface Piece {
  id: string;
  name: string;
  shape: Point[];
  color: string;
}

export interface PuzzleConfig {
  width: number;
  height: number;
  pieces: Piece[];
  timeLimit: number;
}

type LevelDataRow = [number, number, number, number, number, number, number];

const TETROMINOES: Piece[] = [
  { id: "I4", name: "I", color: "#ff3b5c", shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }] },
  { id: "O4", name: "O", color: "#ff9f1a", shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
  { id: "T4", name: "T", color: "#ffdd00", shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }] },
  { id: "S4", name: "S", color: "#00e676", shape: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
  { id: "Z4", name: "Z", color: "#00d4ff", shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }] },
  { id: "J4", name: "J", color: "#536dfe", shape: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }] },
  { id: "L4", name: "L", color: "#e040fb", shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }] },
];

const TROMINOES: Piece[] = [
  { id: "I3", name: "I3", color: "#00bfa5", shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }] },
  { id: "L3", name: "L3", color: "#ff6e40", shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }] },
];

const DOMINO: Piece[] = [{ id: "I2", name: "I2", color: "#7c4dff", shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }] }];
const MONOMINO: Piece[] = [{ id: "I1", name: "I1", color: "#ff4081", shape: [{ x: 0, y: 0 }] }];

const PENTOMINOES: Piece[] = [
  { id: "F5", name: "F", color: "#26c6da", shape: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }] },
  { id: "I5", name: "I5", color: "#d4e157", shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }] },
  { id: "L5", name: "L5", color: "#ff7043", shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }, { x: 1, y: 3 }] },
  { id: "N5", name: "N", color: "#7e57c2", shape: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }, { x: 0, y: 3 }] },
  { id: "P5", name: "P", color: "#26a69a", shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }] },
  { id: "T5", name: "T5", color: "#ef5350", shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }] },
  { id: "U5", name: "U", color: "#8bc34a", shape: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }] },
  { id: "V5", name: "V", color: "#ffa726", shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }] },
  { id: "W5", name: "W", color: "#42a5f5", shape: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }] },
  { id: "X5", name: "X", color: "#ec407a", shape: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }] },
  { id: "Y5", name: "Y", color: "#ab47bc", shape: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }] },
  { id: "Z5", name: "Z5", color: "#66bb6a", shape: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }] },
];

const LEVEL_P5: Record<number, number> = { 70: 2, 78: 2 };

const LEVEL_DATA: LevelDataRow[] = [
  [2, 4, 2, 0, 0, 0, 180], [3, 3, 2, 0, 0, 1, 170], [2, 5, 2, 0, 1, 0, 160], [2, 5, 1, 2, 0, 0, 150], [3, 4, 3, 0, 0, 0, 145],
  [4, 3, 3, 0, 0, 0, 140], [2, 6, 3, 0, 0, 0, 135], [3, 4, 2, 1, 0, 1, 130], [2, 7, 3, 0, 1, 0, 125], [2, 7, 2, 2, 0, 0, 120],
  [4, 3, 2, 1, 0, 1, 140], [2, 6, 2, 1, 0, 1, 135], [2, 7, 2, 1, 1, 1, 130], [3, 5, 3, 1, 0, 0, 125], [5, 3, 3, 1, 0, 0, 122],
  [3, 5, 3, 0, 1, 1, 118], [3, 5, 2, 2, 0, 1, 114], [4, 4, 4, 0, 0, 0, 110], [4, 4, 3, 1, 0, 1, 106], [4, 4, 2, 2, 1, 0, 100],
  [2, 8, 4, 0, 0, 0, 120], [2, 8, 3, 1, 0, 1, 116], [2, 8, 2, 2, 1, 0, 112], [3, 6, 4, 0, 1, 0, 108], [3, 6, 3, 2, 0, 0, 104],
  [6, 3, 4, 0, 1, 0, 100], [3, 6, 3, 1, 1, 1, 96], [2, 9, 4, 0, 1, 0, 92], [2, 9, 3, 2, 0, 0, 88], [6, 3, 3, 2, 0, 0, 85],
  [4, 5, 5, 0, 0, 0, 100], [5, 4, 5, 0, 0, 0, 96], [4, 5, 4, 1, 0, 1, 92], [4, 5, 3, 2, 1, 0, 88], [5, 4, 4, 1, 0, 1, 85],
  [5, 4, 3, 2, 1, 0, 82], [3, 7, 5, 0, 0, 1, 80], [3, 7, 4, 1, 1, 0, 78], [3, 7, 3, 2, 1, 1, 75], [7, 3, 5, 0, 0, 1, 72],
  [7, 3, 4, 1, 1, 0, 90], [7, 3, 3, 2, 1, 1, 86], [2, 12, 5, 1, 0, 1, 82], [12, 2, 5, 1, 0, 1, 80], [2, 12, 4, 2, 1, 0, 78],
  [4, 6, 5, 1, 0, 1, 76], [4, 6, 4, 2, 1, 0, 74], [6, 4, 5, 1, 0, 1, 72], [5, 5, 6, 0, 0, 1, 70], [5, 5, 5, 1, 1, 0, 68],
  [6, 4, 4, 2, 1, 0, 80], [3, 8, 5, 1, 0, 1, 76], [3, 8, 4, 2, 1, 0, 73], [5, 5, 4, 2, 1, 1, 70], [3, 9, 6, 1, 0, 0, 68],
  [3, 9, 6, 0, 1, 1, 66], [3, 9, 5, 2, 0, 1, 64], [4, 7, 6, 1, 0, 1, 62], [3, 10, 6, 2, 0, 0, 60], [4, 7, 5, 2, 1, 0, 58],
  [10, 3, 6, 2, 0, 0, 70], [7, 4, 6, 1, 0, 1, 66], [7, 4, 5, 2, 1, 0, 63], [3, 10, 6, 1, 1, 1, 60], [5, 6, 6, 2, 0, 0, 57],
  [5, 6, 6, 1, 1, 1, 55], [10, 3, 6, 1, 1, 1, 53], [6, 5, 6, 2, 0, 0, 50], [6, 5, 6, 1, 1, 1, 48], [4, 8, 4, 2, 0, 0, 46],
  [4, 8, 6, 2, 1, 0, 58], [12, 2, 4, 2, 1, 0, 55], [8, 3, 5, 1, 0, 1, 52], [8, 3, 4, 2, 1, 0, 50], [9, 3, 6, 1, 0, 0, 48],
  [9, 3, 6, 0, 1, 1, 46], [9, 3, 5, 2, 0, 1, 44], [8, 4, 4, 2, 0, 0, 42], [8, 4, 6, 2, 1, 0, 40], [2, 15, 6, 2, 0, 0, 38],
  [15, 2, 6, 2, 0, 0, 35], [2, 15, 6, 1, 1, 1, 32], [15, 2, 6, 1, 1, 1, 30], [2, 16, 6, 2, 1, 0, 28], [6, 2, 3, 0, 0, 0, 38],
  [6, 2, 2, 1, 0, 1, 35], [7, 2, 3, 0, 1, 0, 33], [7, 2, 2, 2, 0, 0, 30], [10, 2, 4, 1, 0, 1, 28], [8, 2, 3, 1, 0, 1, 26],
  [6, 2, 1, 2, 1, 0, 35], [7, 2, 2, 1, 1, 1, 32], [8, 2, 2, 2, 1, 0, 30], [5, 3, 3, 0, 1, 1, 28], [5, 3, 2, 2, 0, 1, 26],
  [6, 3, 3, 1, 1, 1, 32], [2, 9, 3, 1, 1, 1, 30], [3, 4, 1, 2, 1, 0, 22], [4, 3, 1, 2, 1, 0, 20], [2, 6, 1, 2, 1, 0, 18],
];

export function rotateShape(shape: Point[]): Point[] {
  const rotated = shape.map((p) => ({ x: -p.y, y: p.x }));
  const minX = Math.min(...rotated.map((p) => p.x));
  const minY = Math.min(...rotated.map((p) => p.y));
  return rotated.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

export function flipShape(shape: Point[]): Point[] {
  const flipped = shape.map((p) => ({ x: -p.x, y: p.y }));
  const minX = Math.min(...flipped.map((p) => p.x));
  const minY = Math.min(...flipped.map((p) => p.y));
  return flipped.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

function normalizeShape(shape: Point[]) {
  const minX = Math.min(...shape.map((p) => p.x));
  const minY = Math.min(...shape.map((p) => p.y));
  return shape
    .map((p) => ({ x: p.x - minX, y: p.y - minY }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
}

function getAllOrientations(shape: Point[]) {
  const seen = new Set<string>();
  const result: Point[][] = [];
  let current = shape;

  for (let f = 0; f < 2; f += 1) {
    for (let r = 0; r < 4; r += 1) {
      const n = normalizeShape(current);
      const key = n.map((p) => `${p.x},${p.y}`).join("|");
      if (!seen.has(key)) {
        seen.add(key);
        result.push(n);
      }
      current = rotateShape(current);
    }
    current = flipShape(current);
  }

  return result;
}

function solveKatamino(width: number, height: number, pieces: Piece[]) {
  const grid = Array.from({ length: height }, () => Array(width).fill(false));
  const orientations = pieces.map((p) => ({ piece: p, shapes: getAllOrientations(p.shape) }));
  const used = Array(orientations.length).fill(false);

  function canPlace(shape: Point[], y: number, x: number) {
    return shape.every((cell) => {
      const row = y + cell.y;
      const col = x + cell.x;
      return row >= 0 && row < height && col >= 0 && col < width && !grid[row][col];
    });
  }

  function fill(shape: Point[], y: number, x: number, value: boolean) {
    for (const cell of shape) {
      grid[y + cell.y][x + cell.x] = value;
    }
  }

  function findNext() {
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        if (!grid[row][col]) return [row, col] as const;
      }
    }
    return null;
  }

  function backtrack(count: number): boolean {
    if (count === orientations.length) return true;
    const next = findNext();
    if (!next) return false;
    const [row, col] = next;

    for (let i = 0; i < orientations.length; i += 1) {
      if (used[i]) continue;
      for (const shape of orientations[i].shapes) {
        for (const pivot of shape) {
          const y = row - pivot.y;
          const x = col - pivot.x;
          if (!canPlace(shape, y, x)) continue;
          fill(shape, y, x, true);
          used[i] = true;
          if (backtrack(count + 1)) return true;
          used[i] = false;
          fill(shape, y, x, false);
        }
      }
    }

    return false;
  }

  return backtrack(0);
}

function randomPick(pool: Piece[], count: number) {
  const result: Piece[] = [];
  for (let i = 0; i < count; i += 1) {
    const piece = pool[Math.floor(Math.random() * pool.length)];
    result.push({
      ...piece,
      shape: piece.shape.map((cell) => ({ ...cell })),
    });
  }
  return result;
}

export function getLevelConfig(level: number): PuzzleConfig | null {
  const row = LEVEL_DATA[level - 1];
  if (!row) return null;

  const [width, height, p4, p3, p2, p1, timeLimit] = row;
  const p5 = LEVEL_P5[level] ?? 0;
  const targetCells = width * height;

  for (let attempt = 0; attempt < 250; attempt += 1) {
    const pieces = [
      ...randomPick(TETROMINOES, p4),
      ...randomPick(TROMINOES, p3),
      ...randomPick(DOMINO, p2),
      ...randomPick(MONOMINO, p1),
      ...randomPick(PENTOMINOES, p5),
    ];
    const pieceCells = pieces.reduce((sum, piece) => sum + piece.shape.length, 0);
    if (pieceCells !== targetCells) continue;
    if (!solveKatamino(width, height, pieces)) continue;
    return { width, height, pieces, timeLimit };
  }

  return null;
}

export const TOTAL_LEVELS = LEVEL_DATA.length;
