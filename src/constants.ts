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

export const ALL_PIECES: Piece[] = [...TETROMINOES, ...TROMINOES, ...DOMINO, ...MONOMINO];

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
