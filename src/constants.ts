export type Point = { x: number; y: number };

export interface Piece {
  id: string;
  name: string;
  shape: Point[]; // Relative coordinates
  color: string;
}

// Tetrominoes (4 squares) — vibrant, high-contrast palette
const TETROMINOES: Piece[] = [
  { id: 'I4', name: 'I', color: '#ff3b5c', shape: [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}, {x:0,y:3}] },
  { id: 'O4', name: 'O', color: '#ff9f1a', shape: [{x:0,y:0}, {x:1,y:0}, {x:0,y:1}, {x:1,y:1}] },
  { id: 'T4', name: 'T', color: '#ffdd00', shape: [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}, {x:1,y:1}] },
  { id: 'S4', name: 'S', color: '#00e676', shape: [{x:1,y:0}, {x:2,y:0}, {x:0,y:1}, {x:1,y:1}] },
  { id: 'Z4', name: 'Z', color: '#00d4ff', shape: [{x:0,y:0}, {x:1,y:0}, {x:1,y:1}, {x:2,y:1}] },
  { id: 'J4', name: 'J', color: '#536dfe', shape: [{x:1,y:0}, {x:1,y:1}, {x:0,y:2}, {x:1,y:2}] },
  { id: 'L4', name: 'L', color: '#e040fb', shape: [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}, {x:1,y:2}] },
];

// Trominoes (3 squares)
const TROMINOES: Piece[] = [
  { id: 'I3', name: 'I3', color: '#00bfa5', shape: [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}] },
  { id: 'L3', name: 'L3', color: '#ff6e40', shape: [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}] },
];

// Domino (2 squares)
const DOMINO: Piece[] = [
  { id: 'I2', name: 'I2', color: '#7c4dff', shape: [{x:0,y:0}, {x:0,y:1}] },
];

// Monomino (1 square)
const MONOMINO: Piece[] = [
  { id: 'I1', name: 'I1', color: '#ff4081', shape: [{x:0,y:0}] },
];

// Pentominoes (5 squares) — 12 free pentominoes
export const PENTOMINOES: Piece[] = [
  // F: two-step offset staircase with centre branch
  { id: 'F5', name: 'F', color: '#26c6da', shape: [{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1},{x:1,y:2}] },
  // I: straight line of 5
  { id: 'I5', name: 'I5', color: '#d4e157', shape: [{x:0,y:0},{x:0,y:1},{x:0,y:2},{x:0,y:3},{x:0,y:4}] },
  // L: long L-shape
  { id: 'L5', name: 'L5', color: '#ff7043', shape: [{x:0,y:0},{x:0,y:1},{x:0,y:2},{x:0,y:3},{x:1,y:3}] },
  // N: zigzag / skew
  { id: 'N5', name: 'N', color: '#7e57c2', shape: [{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:0,y:2},{x:0,y:3}] },
  // P: 2×3 rectangle minus one corner
  { id: 'P5', name: 'P', color: '#26a69a', shape: [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:0,y:2}] },
  // T: T-shape with 5 cells
  { id: 'T5', name: 'T5', color: '#ef5350', shape: [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:1,y:1},{x:1,y:2}] },
  // U: U-shape
  { id: 'U5', name: 'U', color: '#8bc34a', shape: [{x:0,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1}] },
  // V: V / corner shape
  { id: 'V5', name: 'V', color: '#ffa726', shape: [{x:0,y:0},{x:0,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2}] },
  // W: staircase
  { id: 'W5', name: 'W', color: '#42a5f5', shape: [{x:0,y:0},{x:0,y:1},{x:1,y:1},{x:1,y:2},{x:2,y:2}] },
  // X: plus sign (only 1 orientation)
  { id: 'X5', name: 'X', color: '#ec407a', shape: [{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:1,y:2}] },
  // Y: Y-shape
  { id: 'Y5', name: 'Y', color: '#ab47bc', shape: [{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:1,y:2},{x:1,y:3}] },
  // Z: Z-shape with 5 cells
  { id: 'Z5', name: 'Z5', color: '#66bb6a', shape: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:1,y:2},{x:2,y:2}] },
];

export const ALL_PIECES: Piece[] = [...TETROMINOES, ...TROMINOES, ...DOMINO, ...MONOMINO, ...PENTOMINOES];

export function rotateShape(shape: Point[]): Point[] {
  const rotated = shape.map(p => ({ x: -p.y, y: p.x }));
  const minX = Math.min(...rotated.map(p => p.x));
  const minY = Math.min(...rotated.map(p => p.y));
  return rotated.map(p => ({ x: p.x - minX, y: p.y - minY }));
}

export function flipShape(shape: Point[]): Point[] {
  const flipped = shape.map(p => ({ x: -p.x, y: p.y }));
  const minX = Math.min(...flipped.map(p => p.x));
  const minY = Math.min(...flipped.map(p => p.y));
  return flipped.map(p => ({ x: p.x - minX, y: p.y - minY }));
}
