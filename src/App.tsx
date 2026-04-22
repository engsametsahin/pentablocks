/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCw, FlipHorizontal, RefreshCw, Trophy, Timer, ChevronRight, ChevronLeft, Lock, Users, User, Star, BarChart3, Target, Zap, Medal, Link2, Copy, Swords, Shield, TrendingUp, Clock, ChevronUp, ChevronDown, Minus } from 'lucide-react';
import { ALL_PIECES, PENTOMINOES, Piece, Point, rotateShape, flipShape } from './constants';
import { LEVEL_DATA, LEVEL_P5, LEVEL_BLOCKED } from './level-data';
import {
  fetchArenaProfile, joinArenaQueue, leaveArenaQueue, pollArenaQueueStatus,
  fetchArenaMatch, submitArenaMatchResult,
  getArenaTier, ARENA_TIERS,
  type ArenaProfile, type ArenaMatch,
} from './lib/arena';
import { analyzeKatamino, solveKatamino } from './solver';
import { cn } from './lib/utils';
import { trackEvent } from './lib/analytics';
import { configureAdSensePreference, initializeAdSense } from './lib/adsense';
import { bulkUpdateAdminMembership, fetchAdminUsers, fetchCloudProgress, fetchCurrentUser, resendEmailVerification, saveCloudProgress, signInGoogle, signInGuest, signInNickname, signOutCloud, signUpNickname, updateAdminMembership, updateGuestNickname, verifyEmailConfirmation, type AdminCloudUser, type CloudUser } from './lib/cloud';
import { mountGoogleLoginButton } from './lib/googleIdentity';
import { playSoundCue, unlockAudio } from './lib/sound';
import {
  createMultiplayerRoom,
  fetchMultiplayerRoom,
  fetchMultiplayerChallenge,
  fetchMultiplayerStats,
  joinMultiplayerRoom,
  readyMultiplayerRoomNextRound,
  startMultiplayerRoom,
  submitMultiplayerRoomRound,
  submitMultiplayerChallengeResult,
  type MultiplayerChallengeSnapshot,
  type MultiplayerRoomSnapshot,
  type MultiplayerStats,
} from './lib/multiplayer';

const CELL_SIZE = 45;
const GRID_PADDING = 32; // p-8
const CONSENT_KEY = 'pentablocks-consent-v1';
const SESSION_COUNT_KEY = 'pentablocks-session-count';
const AD_BREAK_INTERVAL = 3;
const TOUCH_DRAG_THRESHOLD_PX = 3;
const TOUCH_LONG_PRESS_MS = 420;
const LOCAL_COMPLETED_KEY = 'katamino-completed';
const LOCAL_BEST_TIMES_KEY = 'katamino-best-times';
const LOCAL_PLAYER_STATS_KEY = 'katamino-player-stats';
const LOCAL_LAST_LEVEL_KEY = 'katamino-last-level';
const RECENT_PUZZLE_HISTORY_KEY = 'pentablocks-recent-puzzles';
const RECENT_PUZZLE_HISTORY_LIMIT = 36;
const MOBILE_CONTROLS_HINT_SEEN_KEY = 'pentablocks-mobile-controls-hint-seen';
const PRECOMPUTED_POOL_SIZE = 12;
const PRECOMPUTED_POOL_SOLVED_TARGET = 24;
const PRECOMPUTED_POOL_MAX_ATTEMPTS = 520;
const THEME_MODE_KEY = 'pentablocks-theme-mode';
const DEFAULT_PLAYER_STATS: PlayerStats = {
  gamesStarted: 0,
  wins: 0,
  losses: 0,
  restarts: 0,
  hintsUsed: 0,
  totalPlaySeconds: 0,
};

function getResponsiveCellSize(viewportWidth: number) {
  if (viewportWidth <= 390) return 34;
  if (viewportWidth <= 480) return 36;
  if (viewportWidth <= 640) return 40;
  return CELL_SIZE;
}

type Screen = 'menu' | 'levelSelect' | 'game' | 'stats' | 'multiplayer' | 'profile' | 'admin' | 'arena';
type GameMode = 'single' | 'multiplayer' | 'arena';
type RoomDifficulty = 'easy' | 'moderate' | 'hard' | 'very_hard';
type ThemeMode = 'dark' | 'light' | 'auto';

type LevelFilter = 'all' | 'unlocked' | 'completed';
type ToastTone = 'neutral' | 'success' | 'warning';

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

/** Minimal touch tracking — tap vs drag detection only. */
interface PointerTrack {
  pointerId: number;
  id: string;
  isFromGrid: boolean;
  pointerType: 'mouse' | 'touch' | 'pen' | 'legacy-touch';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  longPressTriggered: boolean;
  longPressTimer: number | null;
}

interface PlacedPiece extends Piece {
  position: Point;
  currentShape: Point[];
  rotation: number;
  isFlipped: boolean;
}

interface LevelConfig {
  id: number;
  width: number;
  height: number;
  timeSeconds: number;
  p4: number;
  p3: number;
  p2: number;
  p1: number;
  p5: number;
  blockedCells: [number, number][];
  label: string;
}

interface SolvablePoolEntry {
  pieces: Piece[];
  fingerprint: string;
  difficultyScore: number;
  distanceToTarget: number;
}

interface PuzzleGenerationTelemetry {
  source: 'pool' | 'live' | 'exhaustive';
  attemptsUsed: number;
  solvedCandidates: number;
  poolSize: number;
  recentHistorySize: number;
}

interface PuzzleSelectionResult {
  entry: SolvablePoolEntry;
  telemetry: PuzzleGenerationTelemetry;
}

interface PlayerStats {
  gamesStarted: number;
  wins: number;
  losses: number;
  restarts: number;
  hintsUsed: number;
  totalPlaySeconds: number;
}

interface ActiveChallengeState {
  code: string;
  levelId: number;
  puzzleSeed: string;
  isRanked: boolean;
  startAt: string | null;
  winnerUserId: number | null;
}

interface ActiveRoomState {
  code: string;
  totalRounds: number;
  roundNumber: number;
  maxPlayers: number;
  championUserId: number | null;
}

interface ActiveRoomLeaderboardRow {
  userId: number;
  displayName: string;
  totalPoints: number;
}

interface ConsentState {
  acceptedAt: string;
  personalizedAds: boolean;
}

const ROOM_DIFFICULTY_OPTIONS: Array<{
  value: RoomDifficulty;
  label: string;
  startLevel: number;
}> = [
  { value: 'easy', label: 'Easy', startLevel: 10 },
  { value: 'moderate', label: 'Moderate', startLevel: 30 },
  { value: 'hard', label: 'Hard', startLevel: 60 },
  { value: 'very_hard', label: 'Very Hard', startLevel: 85 },
];

// ─── 100 Unique Levels ───────────────────────────────────────────────────────
// Every level has a unique (width, height, p4, p3, p2, p1) combination.
// Cell counts verified: p4*4 + p3*3 + p2*2 + p1*1 === width * height.
// Piece pool limits: p4≤7, p3≤2, p2≤1, p1≤1.
const DIFFICULTY_BANDS: Array<{ name: string; range: [number, number] }> = [
  { name: 'Easy', range: [1, 10] },
  { name: 'Moderate', range: [11, 30] },
  { name: 'Hard', range: [31, 60] },
  { name: 'Very Hard', range: [61, 80] },
  { name: 'Extreme', range: [81, 100] },
];

const LEVEL_CONFIGS: LevelConfig[] = (() => {
  return LEVEL_DATA.map(([w, h, p4, p3, p2, p1, t], i) => {
    const levelId = i + 1;
    const band = DIFFICULTY_BANDS.find((entry) => levelId >= entry.range[0] && levelId <= entry.range[1]) ?? DIFFICULTY_BANDS[DIFFICULTY_BANDS.length - 1];
    const sub = levelId - band.range[0] + 1;
    return {
      id: levelId,
      width: w,
      height: h,
      p4,
      p3,
      p2,
      p1,
      p5: LEVEL_P5[levelId] ?? 0,
      blockedCells: LEVEL_BLOCKED[levelId] ?? [],
      timeSeconds: t,
      label: `${band.name} ${sub}`,
    };
  });
})();
const MAX_LEVEL = LEVEL_CONFIGS.length; // 100

const TIERS = [
  { name: 'Easy',      range: [1, 10],   bg: 'bg-emerald-50',  border: 'border-emerald-200',  text: 'text-emerald-700',  dot: 'bg-emerald-500',  darkBg: 'bg-emerald-950/40',  darkBorder: 'border-emerald-700/50',  darkText: 'text-emerald-400' },
  { name: 'Moderate',  range: [11, 30],  bg: 'bg-sky-50',      border: 'border-sky-200',      text: 'text-sky-700',      dot: 'bg-sky-500',      darkBg: 'bg-sky-950/40',      darkBorder: 'border-sky-700/50',      darkText: 'text-sky-400' },
  { name: 'Hard',      range: [31, 60],  bg: 'bg-indigo-50',   border: 'border-indigo-200',   text: 'text-indigo-700',   dot: 'bg-indigo-500',   darkBg: 'bg-indigo-950/40',   darkBorder: 'border-indigo-700/50',   darkText: 'text-indigo-400' },
  { name: 'Very Hard', range: [61, 80],  bg: 'bg-orange-50',   border: 'border-orange-200',   text: 'text-orange-700',   dot: 'bg-orange-500',   darkBg: 'bg-orange-950/40',   darkBorder: 'border-orange-700/50',   darkText: 'text-orange-400' },
  { name: 'Extreme',   range: [81, 100], bg: 'bg-red-50',      border: 'border-red-200',      text: 'text-red-700',      dot: 'bg-red-500',      darkBg: 'bg-red-950/40',      darkBorder: 'border-red-700/50',      darkText: 'text-red-400' },
];

function getTier(levelId: number) {
  return TIERS.find((tier) => levelId >= tier.range[0] && levelId <= tier.range[1]) ?? TIERS[TIERS.length - 1];
}

function getLevelStarRating(levelId: number, remainingSeconds?: number): 0 | 1 | 2 | 3 {
  if (remainingSeconds === undefined) return 0;
  const cfg = LEVEL_CONFIGS[levelId - 1];
  if (!cfg || cfg.timeSeconds <= 0) return 1;
  const ratio = Math.max(0, Math.min(1, remainingSeconds / cfg.timeSeconds));
  if (ratio >= 0.66) return 3;
  if (ratio >= 0.33) return 2;
  return 1;
}

function getShapeSize(shape: Point[]) {
  const width = Math.max(...shape.map((p) => p.x)) + 1;
  const height = Math.max(...shape.map((p) => p.y)) + 1;
  return { width, height };
}

function getMaxFootprint(shape: Point[]) {
  const variants: Point[][] = [];
  let rotated = shape;
  variants.push(rotated);
  for (let i = 0; i < 3; i += 1) {
    rotated = rotateShape(rotated);
    variants.push(rotated);
  }
  let flipped = flipShape(shape);
  variants.push(flipped);
  for (let i = 0; i < 3; i += 1) {
    flipped = rotateShape(flipped);
    variants.push(flipped);
  }

  let maxWidth = 0;
  let maxHeight = 0;
  for (const variant of variants) {
    const size = getShapeSize(variant);
    if (size.width > maxWidth) maxWidth = size.width;
    if (size.height > maxHeight) maxHeight = size.height;
  }
  return { width: maxWidth, height: maxHeight };
}

const PIECE_MAX_FOOTPRINT: Record<string, { width: number; height: number }> = Object.fromEntries(
  ALL_PIECES.map((piece) => [piece.id, getMaxFootprint(piece.shape)]),
);

const PIECE_BY_ID: Record<string, Piece> = Object.fromEntries(
  ALL_PIECES.map((piece) => [piece.id, piece]),
);

/** Build inline style for a single block cell with a 2.5D beveled look */
function blockCellStyle(color: string, size: number, left: number, top: number, opacity = 1): React.CSSProperties {
  // Derive lighter and darker shades for the bevel
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const lighter = `rgba(${Math.min(255, r + 70)},${Math.min(255, g + 70)},${Math.min(255, b + 70)},0.9)`;
  const darker  = `rgba(${Math.max(0, r - 60)},${Math.max(0, g - 60)},${Math.max(0, b - 60)},0.95)`;
  const glow    = `rgba(${r},${g},${b},0.35)`;

  return {
    position: 'absolute' as const,
    left,
    top,
    width: size,
    height: size,
    backgroundColor: color,
    borderRadius: 6,
    opacity,
    // 3-sided bevel: light top-left, dark bottom-right, strong outline
    borderTop: `2.5px solid ${lighter}`,
    borderLeft: `2.5px solid ${lighter}`,
    borderBottom: `2.5px solid ${darker}`,
    borderRight: `2.5px solid ${darker}`,
    boxShadow: `inset 0 1px 2px ${lighter}, inset 0 -1px 2px ${darker}, 0 0 6px ${glow}`,
    backgroundImage: `linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 50%, rgba(0,0,0,0.12) 100%)`,
  };
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function createSeededRng(seed: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    h += h << 5;
    return (h >>> 0) / 4294967296;
  };
}

function shuffleWithRng<T>(items: T[], rng: () => number) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function getBoardDimensions(cfg: Pick<LevelConfig, 'width' | 'height'>) {
  return cfg.width >= cfg.height
    ? { width: cfg.width, height: cfg.height }
    : { width: cfg.height, height: cfg.width };
}

function orientShapeForStash(shape: Point[]) {
  let best = shape;
  let current = shape;

  for (let i = 0; i < 4; i += 1) {
    const currentSize = getShapeSize(current);
    const bestSize = getShapeSize(best);
    const isBetter =
      currentSize.width > bestSize.width
      || (currentSize.width === bestSize.width && currentSize.height < bestSize.height);

    if (isBetter) {
      best = current;
    }
    current = rotateShape(current);
  }

  return best;
}

function orientPiecesForStash(pieces: Piece[]) {
  return pieces.map((piece) => ({
    ...piece,
    shape: orientShapeForStash(piece.shape),
  }));
}

const solvablePieceSetCache = new Map<string, Piece[]>();
const precomputedLevelPoolCache = new Map<number, SolvablePoolEntry[]>();
const PIECE_DIFFICULTY_WEIGHT: Record<string, number> = {
  I1: 0.2,
  I2: 0.4,
  I3: 0.65,
  O4: 0.75,
  I4: 0.9,
  L3: 1.1,
  T4: 1.2,
  J4: 1.25,
  L4: 1.25,
  S4: 1.45,
  Z4: 1.45,
  // Pentominoes — all harder than tetrominoes; varies by orientation count
  X5: 1.1,  // Plus sign: only 1 unique orientation (fully symmetric)
  I5: 1.2,  // Straight: only 2 orientations
  T5: 1.35, // T-shape: 4 orientations, symmetric
  V5: 1.4,  // V / corner: 4 orientations
  P5: 1.45, // 2×3 minus corner: 8 orientations (chiral)
  W5: 1.5,  // Staircase: 4 orientations
  L5: 1.5,  // Long L: 8 orientations (chiral)
  U5: 1.55, // U: 4 orientations, tricky gap
  F5: 1.6,  // F: 8 orientations (chiral), complex shape
  N5: 1.6,  // N / skew: 8 orientations (chiral)
  Y5: 1.6,  // Y: 8 orientations (chiral)
  Z5: 1.65, // Z: 4 orientations, mirror-asymmetric pair
};

// ── Tier-based piece selection weights ──────────────────────────────────────
// Controls how likely each piece is to appear at different difficulty tiers.
// Higher weight = more likely to be picked.  The system uses weighted random
// selection (without replacement) instead of uniform shuffle, so early levels
// naturally get simpler pieces and late levels get harder ones.
//
// Design rationale:
//   - O4/I4 have few orientations → easier to place → favored early
//   - S4/Z4 are mirror-asymmetric with many orientations → harder → favored late
//   - T4/J4/L4 are mid-complexity → balanced across tiers
//   - Fillers (I1/I2/I3/L3) follow a similar gradient but matter less
//
// Each row: [Easy, Moderate, Hard, Very Hard, Extreme]
const PIECE_TIER_SELECTION_WEIGHT: Record<string, [number, number, number, number, number]> = {
  // Easy pieces — strong early, fade late
  O4: [5.0, 3.5, 2.0, 1.0, 0.5],
  I4: [4.5, 3.0, 2.0, 1.2, 0.8],
  // Mid pieces — balanced curve
  T4: [2.0, 3.0, 3.5, 3.0, 2.5],
  J4: [1.5, 2.5, 3.0, 3.5, 3.0],
  L4: [1.5, 2.5, 3.0, 3.5, 3.0],
  // Hard pieces — weak early, strong late
  S4: [0.5, 1.5, 2.5, 4.0, 5.0],
  Z4: [0.5, 1.5, 2.5, 4.0, 5.0],
  // Fillers
  I3: [3.0, 2.5, 2.0, 1.5, 1.0],
  L3: [1.0, 1.5, 2.0, 2.5, 3.0],
  I2: [2.0, 2.0, 2.0, 2.0, 2.0],
  I1: [2.0, 2.0, 2.0, 2.0, 2.0],
  // Pentominoes — appear only in Very Hard / Extreme tiers
  // [Easy, Moderate, Hard, Very Hard, Extreme]
  I5: [0.0, 0.0, 0.5, 2.0, 3.0],
  X5: [0.0, 0.0, 0.5, 2.0, 2.5],
  T5: [0.0, 0.0, 0.3, 1.5, 2.5],
  V5: [0.0, 0.0, 0.3, 1.5, 2.5],
  P5: [0.0, 0.0, 0.3, 1.5, 2.5],
  W5: [0.0, 0.0, 0.2, 1.5, 2.5],
  L5: [0.0, 0.0, 0.2, 1.5, 2.5],
  U5: [0.0, 0.0, 0.2, 1.5, 2.5],
  F5: [0.0, 0.0, 0.1, 1.2, 2.0],
  N5: [0.0, 0.0, 0.1, 1.2, 2.0],
  Y5: [0.0, 0.0, 0.1, 1.2, 2.0],
  Z5: [0.0, 0.0, 0.1, 1.2, 2.0],
};

/** Get the selection weight for a piece at a given level. */
function getPieceSelectionWeight(pieceId: string, levelId: number): number {
  const tiers = PIECE_TIER_SELECTION_WEIGHT[pieceId];
  if (!tiers) return 1;
  const tierIndex = DIFFICULTY_BANDS.findIndex((band) => levelId >= band.range[0] && levelId <= band.range[1]);
  if (tierIndex < 0) return tiers[tiers.length - 1];
  return tiers[tierIndex];
}

/** Pick `count` items from `items` using weighted random selection (no replacement). */
function weightedPickWithRng<T extends { id: string }>(
  items: T[],
  count: number,
  levelId: number,
  rng: () => number,
): T[] {
  if (count >= items.length) return shuffleWithRng(items, rng);
  const pool = items.map((item) => ({ item, weight: getPieceSelectionWeight(item.id, levelId) }));
  const picked: T[] = [];

  for (let i = 0; i < count; i += 1) {
    const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = rng() * totalWeight;
    let chosenIdx = 0;
    for (let j = 0; j < pool.length; j += 1) {
      roll -= pool[j].weight;
      if (roll <= 0) { chosenIdx = j; break; }
    }
    picked.push(pool[chosenIdx].item);
    pool.splice(chosenIdx, 1);
  }

  return picked;
}

function clonePieceSet(pieces: Piece[]) {
  return pieces.map((piece) => ({
    ...piece,
    shape: piece.shape.map((point) => ({ ...point })),
  }));
}

function cloneSolvablePoolEntry(entry: SolvablePoolEntry): SolvablePoolEntry {
  return {
    ...entry,
    pieces: clonePieceSet(entry.pieces),
  };
}

function buildPuzzleFingerprint(cfg: LevelConfig, pieces: Piece[]) {
  const sortedIds = pieces.map((piece) => piece.id).sort().join(',');
  return `${cfg.id}:${sortedIds}`;
}

function normalizeRecentPuzzleFingerprints(input: unknown) {
  if (!Array.isArray(input)) return [];
  const unique: string[] = [];
  for (const value of input) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim().slice(0, 120);
    if (!normalized) continue;
    if (unique.includes(normalized)) continue;
    unique.push(normalized);
  }
  return unique.slice(-RECENT_PUZZLE_HISTORY_LIMIT);
}

function appendRecentPuzzleFingerprint(current: string[], fingerprint: string) {
  const filtered = current.filter((value) => value !== fingerprint);
  filtered.push(fingerprint);
  return filtered.slice(-RECENT_PUZZLE_HISTORY_LIMIT);
}

function createChallengePiecePicker(cfg: LevelConfig, random: () => number) {
  const p4 = ALL_PIECES.filter((piece) => piece.shape.length === 4);
  const p3 = ALL_PIECES.filter((piece) => piece.shape.length === 3);
  const p2 = ALL_PIECES.filter((piece) => piece.shape.length === 2);
  const p1 = ALL_PIECES.filter((piece) => piece.shape.length === 1);
  const p5 = PENTOMINOES; // all 12 pentominoes

  return () => [
    ...weightedPickWithRng(p4, cfg.p4, cfg.id, random),
    ...weightedPickWithRng(p3, cfg.p3, cfg.id, random),
    ...weightedPickWithRng(p2, cfg.p2, cfg.id, random),
    ...weightedPickWithRng(p1, cfg.p1, cfg.id, random),
    ...weightedPickWithRng(p5, cfg.p5, cfg.id, random),
  ];
}

function scorePieceMix(pieces: Piece[]) {
  return pieces.reduce((sum, piece) => sum + (PIECE_DIFFICULTY_WEIGHT[piece.id] ?? 1), 0);
}

/**
 * Returns the tier-weighted expected average difficulty of picking one piece
 * from `pool` at a given level. Reflects the actual probability distribution
 * used by `weightedPickWithRng` — easy pieces dominate early, hard late.
 */
function expectedPieceDifficulty(pool: Piece[], levelId: number): number {
  if (pool.length === 0) return 0;
  const totalWeight = pool.reduce((s, p) => s + getPieceSelectionWeight(p.id, levelId), 0);
  if (totalWeight === 0) return 0;
  return pool.reduce(
    (s, p) => s + getPieceSelectionWeight(p.id, levelId) * (PIECE_DIFFICULTY_WEIGHT[p.id] ?? 1),
    0,
  ) / totalWeight;
}

function estimateTargetDifficulty(cfg: LevelConfig) {
  const progress = (cfg.id - 1) / Math.max(1, MAX_LEVEL - 1);
  const board = getBoardDimensions(cfg);
  const effectiveCells = board.width * board.height - cfg.blockedCells.length;
  const areaFactor = effectiveCells / 36;

  // Expected mix: each piece slot contributes the tier-weighted average difficulty
  // of its piece pool. This tracks what weightedPickWithRng actually produces —
  // early levels skew toward easy pieces, late levels toward hard ones.
  const p4Pool = ALL_PIECES.filter((p) => p.shape.length === 4);
  const p3Pool = ALL_PIECES.filter((p) => p.shape.length === 3);
  const p2Pool = ALL_PIECES.filter((p) => p.shape.length === 2);
  const p1Pool = ALL_PIECES.filter((p) => p.shape.length === 1);
  const expectedMix =
    cfg.p4 * expectedPieceDifficulty(p4Pool, cfg.id) +
    cfg.p3 * expectedPieceDifficulty(p3Pool, cfg.id) +
    cfg.p2 * expectedPieceDifficulty(p2Pool, cfg.id) +
    cfg.p1 * expectedPieceDifficulty(p1Pool, cfg.id) +
    cfg.p5 * expectedPieceDifficulty(PENTOMINOES, cfg.id);

  return 4 + progress * 28 + areaFactor * 4 + expectedMix * 0.35;
}

function scoreSolvedCandidate(cfg: LevelConfig, pieces: Piece[], searchNodes: number, deadRegionPrunes: number) {
  const board = getBoardDimensions(cfg);
  const aspectPenalty = Math.abs(board.width - board.height) * 0.12;
  const pieceMixScore = scorePieceMix(pieces) * 1.35;
  const searchScore = Math.log10(searchNodes + 1) * 8.5;
  const pruneScore = Math.log10(deadRegionPrunes + 1) * 4.2;
  return pieceMixScore + searchScore + pruneScore + aspectPenalty;
}

function getPrecomputedLevelPool(cfg: LevelConfig) {
  if (precomputedLevelPoolCache.has(cfg.id)) {
    return precomputedLevelPoolCache.get(cfg.id)!.map(cloneSolvablePoolEntry);
  }

  const board = getBoardDimensions(cfg);
  const targetDifficulty = estimateTargetDifficulty(cfg);
  const rng = createSeededRng(`pool:v1:${cfg.id}`);
  const pickCandidates = createChallengePiecePicker(cfg, rng);
  const solvedByFingerprint = new Map<string, SolvablePoolEntry>();
  const blocked = cfg.blockedCells.length > 0 ? cfg.blockedCells : undefined;

  for (
    let attempt = 0;
    attempt < PRECOMPUTED_POOL_MAX_ATTEMPTS && solvedByFingerprint.size < PRECOMPUTED_POOL_SOLVED_TARGET;
    attempt += 1
  ) {
    const candidate = pickCandidates();
    const fingerprint = buildPuzzleFingerprint(cfg, candidate);
    if (solvedByFingerprint.has(fingerprint)) continue;
    const analysis = analyzeKatamino(board.width, board.height, candidate, blocked);
    if (!analysis.solution) continue;

    const difficultyScore = scoreSolvedCandidate(
      cfg,
      candidate,
      analysis.searchNodes,
      analysis.deadRegionPrunes,
    );
    const distanceToTarget = Math.abs(difficultyScore - targetDifficulty);
    solvedByFingerprint.set(fingerprint, {
      pieces: clonePieceSet(candidate),
      fingerprint,
      difficultyScore,
      distanceToTarget,
    });
  }

  const pool = [...solvedByFingerprint.values()]
    .sort((a, b) => {
      if (a.distanceToTarget !== b.distanceToTarget) {
        return a.distanceToTarget - b.distanceToTarget;
      }
      return a.fingerprint.localeCompare(b.fingerprint);
    })
    .slice(0, PRECOMPUTED_POOL_SIZE)
    .map(cloneSolvablePoolEntry);

  precomputedLevelPoolCache.set(cfg.id, pool.map(cloneSolvablePoolEntry));
  return pool;
}

function pickPoolCandidate(
  cfg: LevelConfig,
  options?: {
    seed?: string;
    recentFingerprints?: Set<string>;
    allowRecentFallback?: boolean;
    recentHistorySize?: number;
  },
): PuzzleSelectionResult | null {
  const pool = getPrecomputedLevelPool(cfg);
  if (pool.length === 0) return null;

  const recentFingerprints = options?.recentFingerprints ?? new Set<string>();
  const filtered = pool.filter((entry) => !recentFingerprints.has(entry.fingerprint));
  const source = filtered.length > 0
    ? filtered
    : (options?.allowRecentFallback === false ? [] : pool);
  if (source.length === 0) return null;

  const sorted = [...source].sort((a, b) => {
    if (a.distanceToTarget !== b.distanceToTarget) {
      return a.distanceToTarget - b.distanceToTarget;
    }
    return a.fingerprint.localeCompare(b.fingerprint);
  });
  const topBand = sorted.slice(0, Math.min(6, sorted.length));
  if (topBand.length === 0) return null;
  const picker = options?.seed
    ? createSeededRng(`pool-pick:${cfg.id}:${options.seed}`)
    : Math.random;
  const index = Math.floor(picker() * topBand.length);
  return {
    entry: cloneSolvablePoolEntry(topBand[index]),
    telemetry: {
      source: 'pool',
      attemptsUsed: 0,
      solvedCandidates: 0,
      poolSize: pool.length,
      recentHistorySize: options?.recentHistorySize ?? recentFingerprints.size,
    },
  };
}

function findSolvablePieceSet(
  cfg: LevelConfig,
  options?: {
    cacheKey?: string;
    seed?: string;
    random?: () => number;
    attemptsPerBatch?: number;
    batchCount?: number;
    recentFingerprints?: Set<string>;
    noveltyPenalty?: number;
    poolSize?: number;
    recentHistorySize?: number;
  },
): PuzzleSelectionResult {
  const board = getBoardDimensions(cfg);
  const cacheKey = options?.cacheKey;
  const attemptsPerBatch = options?.attemptsPerBatch ?? 140;
  const batchCount = options?.seed ? (options?.batchCount ?? 8) : 1;
  const targetDifficulty = estimateTargetDifficulty(cfg);
  const maxSolvedCandidates = options?.seed ? 6 : 5;
  const acceptableDistance = cfg.id <= 20 ? 4.5 : cfg.id <= 60 ? 3.25 : 2.5;
  const recentFingerprints = options?.recentFingerprints ?? new Set<string>();
  const noveltyPenalty = options?.noveltyPenalty ?? 8;
  const poolSize = options?.poolSize ?? 0;
  const recentHistorySize = options?.recentHistorySize ?? recentFingerprints.size;

  if (cacheKey && solvablePieceSetCache.has(cacheKey)) {
    const pieces = clonePieceSet(solvablePieceSetCache.get(cacheKey)!);
    return {
      entry: {
        pieces,
        fingerprint: buildPuzzleFingerprint(cfg, pieces),
        difficultyScore: 0,
        distanceToTarget: 0,
      },
      telemetry: {
        source: 'live',
        attemptsUsed: 0,
        solvedCandidates: 0,
        poolSize,
        recentHistorySize,
      },
    };
  }

  let bestCandidate: SolvablePoolEntry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let solvedCandidates = 0;
  let attemptsUsed = 0;
  const blocked = cfg.blockedCells.length > 0 ? cfg.blockedCells : undefined;

  for (let batch = 0; batch < batchCount; batch += 1) {
    const random = options?.seed
      ? createSeededRng(`${options.seed}:${cfg.id}:batch:${batch}`)
      : (options?.random ?? Math.random);
    const pickCandidates = createChallengePiecePicker(cfg, random);

    for (let attempts = 0; attempts < attemptsPerBatch; attempts += 1) {
      attemptsUsed += 1;
      const candidate = pickCandidates();
      const analysis = analyzeKatamino(board.width, board.height, candidate, blocked);
      if (analysis.solution) {
        solvedCandidates += 1;
        const difficultyScore = scoreSolvedCandidate(
          cfg,
          candidate,
          analysis.searchNodes,
          analysis.deadRegionPrunes,
        );
        const fingerprint = buildPuzzleFingerprint(cfg, candidate);
        const noveltyBoost = recentFingerprints.has(fingerprint) ? noveltyPenalty : 0;
        const distance = Math.abs(difficultyScore - targetDifficulty) + noveltyBoost;

        if (distance < bestDistance) {
          bestCandidate = {
            pieces: clonePieceSet(candidate),
            fingerprint,
            difficultyScore,
            distanceToTarget: distance,
          };
          bestDistance = distance;
        }

        if (distance <= acceptableDistance || solvedCandidates >= maxSolvedCandidates) {
          if (bestCandidate) {
            if (cacheKey) {
              solvablePieceSetCache.set(cacheKey, clonePieceSet(bestCandidate.pieces));
            }
            return {
              entry: cloneSolvablePoolEntry(bestCandidate),
              telemetry: {
                source: 'live',
                attemptsUsed,
                solvedCandidates,
                poolSize,
                recentHistorySize,
              },
            };
          }
        }
      }
    }
  }

  if (bestCandidate) {
    if (cacheKey) {
      solvablePieceSetCache.set(cacheKey, clonePieceSet(bestCandidate.pieces));
    }
    return {
      entry: cloneSolvablePoolEntry(bestCandidate),
      telemetry: {
        source: 'live',
        attemptsUsed,
        solvedCandidates,
        poolSize,
        recentHistorySize,
      },
    };
  }

  if (bestCandidate) {
    // Shouldn't reach here due to early return above, but safety net.
    return {
      entry: cloneSolvablePoolEntry(bestCandidate),
      telemetry: { source: 'live', attemptsUsed, solvedCandidates, poolSize, recentHistorySize },
    };
  }

  const error = new Error(`Unable to generate a solvable puzzle for level ${cfg.id}.`) as Error & {
    generationTelemetry?: PuzzleGenerationTelemetry;
  };
  error.generationTelemetry = {
    source: 'live',
    attemptsUsed,
    solvedCandidates,
    poolSize,
    recentHistorySize,
  };
  throw error;
}

/**
 * Exhaustive last-resort generator: systematically tries ALL possible
 * piece combinations for a level config until one solves.
 * C(7,p4)·C(2,p3)·C(1,p2)·C(1,p1) is at most C(7,4)·2·1·1 = 70 combos,
 * so this is always bounded and fast.
 */
function exhaustiveSolvablePieceSet(cfg: LevelConfig): PuzzleSelectionResult | null {
  const board = getBoardDimensions(cfg);
  const targetDifficulty = estimateTargetDifficulty(cfg);
  const p4Pool = ALL_PIECES.filter((p) => p.shape.length === 4);
  const p3Pool = ALL_PIECES.filter((p) => p.shape.length === 3);
  const p2Pool = ALL_PIECES.filter((p) => p.shape.length === 2);
  const p1Pool = ALL_PIECES.filter((p) => p.shape.length === 1);
  const p5Pool = PENTOMINOES;
  const blocked = cfg.blockedCells.length > 0 ? cfg.blockedCells : undefined;

  function* combinations<T>(arr: T[], k: number): Generator<T[]> {
    if (k === 0) { yield []; return; }
    if (k > arr.length) return;
    for (let i = 0; i <= arr.length - k; i++) {
      for (const rest of combinations(arr.slice(i + 1), k - 1)) {
        yield [arr[i], ...rest];
      }
    }
  }

  let best: PuzzleSelectionResult | null = null;
  let bestDistance = Infinity;

  for (const c4 of combinations(p4Pool, cfg.p4)) {
    for (const c3 of combinations(p3Pool, cfg.p3)) {
      for (const c2 of combinations(p2Pool, cfg.p2)) {
        for (const c1 of combinations(p1Pool, cfg.p1)) {
          for (const c5 of combinations(p5Pool, cfg.p5)) {
            const pieces = [...c4, ...c3, ...c2, ...c1, ...c5];
            const analysis = analyzeKatamino(board.width, board.height, pieces, blocked);
            if (!analysis.solution) continue;

            const score = scoreSolvedCandidate(cfg, pieces, analysis.searchNodes, analysis.deadRegionPrunes);
            const distance = Math.abs(score - targetDifficulty);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = {
                entry: {
                  pieces: clonePieceSet(pieces),
                  fingerprint: buildPuzzleFingerprint(cfg, pieces),
                  difficultyScore: score,
                  distanceToTarget: distance,
                },
                telemetry: { source: 'exhaustive' as PuzzleGenerationTelemetry['source'], attemptsUsed: 0, solvedCandidates: 1, poolSize: 0, recentHistorySize: 0 },
              };
            }
          }
        }
      }
    }
  }
  return best;
}

function generateChallengePieces(
  seed: string,
  cfg: LevelConfig,
  options?: {
    attemptsPerBatch?: number;
    batchCount?: number;
  },
): PuzzleSelectionResult {
  const poolSize = getPrecomputedLevelPool(cfg).length;
  const challengeFromPool = pickPoolCandidate(cfg, {
    seed,
    allowRecentFallback: true,
    recentHistorySize: 0,
  });
  if (challengeFromPool) return challengeFromPool;
  return findSolvablePieceSet(cfg, {
    cacheKey: `challenge:${cfg.id}:${seed}`,
    seed,
    attemptsPerBatch: options?.attemptsPerBatch ?? 160,
    batchCount: options?.batchCount ?? 10,
    poolSize,
    recentHistorySize: 0,
  });
}

function selectSinglePlayerPuzzle(
  cfg: LevelConfig,
  recentHistory: string[],
  options?: {
    attemptsPerBatch?: number;
    batchCount?: number;
    noveltyPenalty?: number;
    allowRecentFallback?: boolean;
  },
): PuzzleSelectionResult {
  const recentFingerprints = new Set(recentHistory);
  const poolSize = getPrecomputedLevelPool(cfg).length;

  // 1) Pool pick (fast, precomputed)
  const fromPool = pickPoolCandidate(cfg, {
    recentFingerprints,
    allowRecentFallback: options?.allowRecentFallback ?? false,
    recentHistorySize: recentHistory.length,
  });
  if (fromPool) return fromPool;

  // 2) Live random generation
  try {
    return findSolvablePieceSet(cfg, {
      random: Math.random,
      attemptsPerBatch: options?.attemptsPerBatch ?? 260,
      batchCount: options?.batchCount ?? 2,
      recentFingerprints,
      noveltyPenalty: options?.noveltyPenalty ?? 12,
      poolSize,
      recentHistorySize: recentHistory.length,
    });
  } catch {
    // 3) Exhaustive brute-force: try every possible piece combination
    const exhaustive = exhaustiveSolvablePieceSet(cfg);
    if (exhaustive) {
      console.warn(`[level ${cfg.id}] random generation failed, used exhaustive fallback`);
      return exhaustive;
    }
    // 4) This should never happen if level configs are valid, but re-throw
    throw new Error(`Level ${cfg.id} has no solvable piece combination — config is invalid.`);
  }
}

function isGeneratedPuzzleStructurallyValid(cfg: LevelConfig, pieces: Piece[]) {
  const board = getBoardDimensions(cfg);
  const expectedPieceCount = cfg.p4 + cfg.p3 + cfg.p2 + cfg.p1 + cfg.p5;
  const expectedCellCount = board.width * board.height - cfg.blockedCells.length;
  if (pieces.length !== expectedPieceCount) return false;
  const uniqueIds = new Set(pieces.map((piece) => piece.id));
  if (uniqueIds.size !== pieces.length) return false;
  const actualCellCount = pieces.reduce((sum, piece) => sum + piece.shape.length, 0);
  return actualCellCount === expectedCellCount;
}

function readLocalCompletedLevels() {
  try {
    const saved = localStorage.getItem(LOCAL_COMPLETED_KEY);
    return saved ? new Set<number>(JSON.parse(saved)) : new Set<number>();
  } catch {
    return new Set<number>();
  }
}

function readLocalBestTimes() {
  try {
    const saved = localStorage.getItem(LOCAL_BEST_TIMES_KEY);
    return saved ? JSON.parse(saved) as Record<number, number> : {};
  } catch {
    return {};
  }
}

function readLocalStats() {
  try {
    const saved = localStorage.getItem(LOCAL_PLAYER_STATS_KEY);
    return saved ? JSON.parse(saved) as PlayerStats : DEFAULT_PLAYER_STATS;
  } catch {
    return DEFAULT_PLAYER_STATS;
  }
}

function readLocalLastLevel() {
  try {
    const raw = Number(localStorage.getItem(LOCAL_LAST_LEVEL_KEY) ?? '1');
    if (!Number.isFinite(raw)) return 1;
    return Math.max(1, Math.min(MAX_LEVEL, Math.floor(raw)));
  } catch {
    return 1;
  }
}

function readLocalRecentPuzzleFingerprints() {
  try {
    const saved = localStorage.getItem(RECENT_PUZZLE_HISTORY_KEY);
    return normalizeRecentPuzzleFingerprints(saved ? JSON.parse(saved) : []);
  } catch {
    return [];
  }
}

function readThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_MODE_KEY);
    if (saved === 'dark' || saved === 'light' || saved === 'auto') return saved;
    return 'dark';
  } catch {
    return 'dark';
  }
}

function authErrorToMessage(error: unknown) {
  const code = error instanceof Error ? error.message : 'unknown_error';
  const map: Record<string, string> = {
    network_error: 'Cloud service is temporarily unreachable. Please try again in a few seconds.',
    request_timeout: 'Cloud request timed out. Please try again.',
    auth_bootstrap_timeout: 'Session check took too long. You can sign in manually.',
    invalid_email: 'Please enter a valid email address.',
    invalid_nickname: 'Nickname must be at least 3 characters and use letters or numbers.',
    password_too_short: 'Password must be at least 8 characters.',
    email_already_registered: 'This email is already registered. Please sign in.',
    nickname_already_registered: 'This nickname is already taken. Please choose another one.',
    invalid_credentials: 'Invalid nickname or password.',
    google_auth_not_configured: 'Google login is not configured yet.',
    guest_auth_failed: 'Guest sign-in failed. Try again.',
    nickname_register_failed: 'Nickname profile creation failed. Please try again.',
    nickname_login_failed: 'Nickname sign-in failed. Please try again.',
    email_register_failed: 'Email registration failed. Try again.',
    email_login_failed: 'Email sign-in failed. Try again.',
    email_verification_failed: 'Email confirmation could not be completed.',
    email_verification_resend_failed: 'Could not resend the confirmation email.',
    email_verification_not_applicable: 'This account does not use email confirmation.',
    missing_verification_token: 'Confirmation token is missing.',
    verification_token_invalid: 'This confirmation link is invalid.',
    verification_token_expired: 'This confirmation link has expired. Please request a new one.',
    admin_only_operation: 'This action is only available to admins.',
    admin_users_fetch_failed: 'Could not load admin user list.',
    admin_membership_update_failed: 'Could not update membership right now.',
    admin_user_not_found: 'User not found.',
    invalid_membership_tier: 'Invalid membership tier.',
    invalid_user_id: 'Invalid user id.',
    unauthorized: 'Please sign in first to use cloud multiplayer.',
    challenge_not_found: 'Challenge code not found.',
    challenge_closed: 'This challenge is already closed.',
    challenge_forbidden: 'You are not a participant in this challenge.',
    challenge_waiting_for_opponent: 'Waiting for opponent to join before starting.',
    challenge_waiting_for_other_player: 'Waiting for the other player to press Play.',
    challenge_full: 'This challenge already has two players.',
    challenge_start_failed: 'Could not start challenge. Please try again.',
    challenge_create_failed: 'Could not create challenge. Please try again.',
    challenge_join_failed: 'Could not join challenge. Please try again.',
    challenge_fetch_failed: 'Could not load challenge details.',
    challenge_submit_failed: 'Could not submit challenge result.',
    room_not_found: 'Room code not found.',
    room_closed: 'This room is already in progress or finished.',
    room_forbidden: 'You are not a participant in this room.',
    room_not_host: 'Only the room host can start the tournament.',
    room_not_enough_players: 'At least 2 players are required to start.',
    room_full: 'This room is full.',
    room_not_active: 'This room is not active right now.',
    room_round_mismatch: 'Round is out of sync. Please refresh room state.',
    room_round_not_found: 'Current round was not found.',
    room_round_not_finished: 'Round is still running. Finish this round first.',
    room_next_round_failed: 'Could not ready up for next round. Please try again.',
    room_create_failed: 'Could not create room. Please try again.',
    room_fetch_failed: 'Could not load room details.',
    room_join_failed: 'Could not join room. Please try again.',
    room_start_failed: 'Could not start room. Please try again.',
    room_submit_failed: 'Could not submit round result.',
    guest_only_operation: 'This action is available for guest users only.',
    guest_nickname_update_failed: 'Could not update guest nickname. Please try again.',
    request_failed_500: 'Server error while signing in. Try again.',
    request_failed_503: 'Auth service is not ready yet. Try again.',
  };
  return map[code] ?? code.replaceAll('_', ' ');
}

function toOrdinal(place: number) {
  if (place % 100 >= 11 && place % 100 <= 13) return `${place}th`;
  if (place % 10 === 1) return `${place}st`;
  if (place % 10 === 2) return `${place}nd`;
  if (place % 10 === 3) return `${place}rd`;
  return `${place}th`;
}

function formatMultiplayerTimeLabel(
  player: MultiplayerChallengeSnapshot['players'][number],
  winnerUserId: number | null,
  roundEnded: boolean,
) {
  const isWinner = winnerUserId !== null && player.userId === winnerUserId;
  if (player.elapsedSeconds !== null) {
    if (isWinner || player.placement === 1) return `Won ${player.elapsedSeconds}s`;
    if (player.placement && player.placement > 1) return `${toOrdinal(player.placement)} ${player.elapsedSeconds}s`;
    return `${player.elapsedSeconds}s`;
  }
  if (roundEnded) return 'DNF';
  return 'In game';
}

function ThemePicker({
  themeMode,
  resolvedTheme,
  onChange,
}: {
  themeMode: ThemeMode;
  resolvedTheme: 'dark' | 'light';
  onChange: (mode: ThemeMode) => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-[90]">
      <div className="rounded-xl border border-black/10 bg-white/90 backdrop-blur px-3 py-2 shadow-sm">
        <p className="text-[9px] uppercase tracking-[0.16em] text-gray-400 font-bold mb-1">
          Theme: {resolvedTheme === 'dark' ? 'Dark' : 'Light'}
        </p>
        <select
          value={themeMode}
          onChange={(e) => onChange(e.target.value as ThemeMode)}
          className="text-xs font-semibold rounded-md border border-black/10 px-2 py-1 bg-white"
          aria-label="Theme mode"
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="auto">Auto (System)</option>
        </select>
      </div>
    </div>
  );
}

// ─── Menu Screen ──────────────────────────────────────────────────────────────
function MenuScreen({
  onSinglePlayer,
  onContinue,
  continueLevel,
  onStats,
  onMultiplayer,
  onArena,
  canOpenAdmin,
  onAdmin,
  resolvedTheme,
}: {
  onSinglePlayer: () => void;
  onContinue?: () => void;
  continueLevel?: number;
  onStats: () => void;
  onMultiplayer: () => void;
  onArena: () => void;
  canOpenAdmin: boolean;
  onAdmin: () => void;
  resolvedTheme: 'dark' | 'light';
}) {
  return (
    <div className={cn(
      'min-h-screen flex flex-col items-center justify-center p-8',
      resolvedTheme === 'dark' ? 'bg-black text-white' : 'bg-[#f5f5f5] text-[#1a1a1a]',
    )}>
      <motion.div
        initial={{ opacity: 0, y: -40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-16"
      >
        <h1 className="text-4xl sm:text-6xl md:text-8xl font-black tracking-tight md:tracking-tighter mb-3 select-none leading-none max-w-full">
          PENTABLOCKS
        </h1>
        <p className={cn(
          'uppercase tracking-[0.3em] text-xs font-bold',
          resolvedTheme === 'dark' ? 'text-gray-500' : 'text-gray-600',
        )}>
          Tetromino Puzzle Challenge
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="flex flex-col gap-4 w-full max-w-xs"
      >
        {onContinue && continueLevel && continueLevel > 1 && (
          <button
            onClick={onContinue}
            className="w-full py-5 bg-emerald-500 text-black rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-emerald-400 transition-all active:scale-95"
          >
            <ChevronRight size={22} /> Continue LV {continueLevel}
          </button>
        )}
        <button
          onClick={onSinglePlayer}
          className={cn(
            'w-full py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all active:scale-95',
            resolvedTheme === 'dark'
              ? 'bg-white text-black hover:bg-gray-100'
              : 'bg-white text-black hover:bg-gray-100 border border-black/10',
          )}
        >
          <User size={22} /> Single Player
        </button>
        <button
          onClick={onStats}
          className="w-full py-5 bg-emerald-500 text-black rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-emerald-400 transition-all active:scale-95"
        >
          <BarChart3 size={22} /> Stats
        </button>
        {canOpenAdmin && (
          <button
            onClick={onAdmin}
            className="w-full py-5 bg-amber-400 text-black rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-amber-300 transition-all active:scale-95"
          >
            <Lock size={22} /> Admin
          </button>
        )}
        <button
          onClick={onArena}
          className="relative w-full py-5 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:from-red-400 hover:to-orange-400 transition-all active:scale-95 overflow-hidden shadow-lg"
        >
          <Swords size={22} /> Arena
          <span className="absolute top-2 right-3 text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Ranked</span>
        </button>
        <button
          onClick={onMultiplayer}
          className={cn(
            'relative w-full py-5 rounded-2xl font-bold text-lg flex items-center justify-center gap-3 transition-all active:scale-95 overflow-hidden',
            resolvedTheme === 'dark'
              ? 'bg-white/10 text-white hover:bg-white/20 border border-white/20'
              : 'bg-black/10 text-[#1a1a1a] hover:bg-black/20 border border-black/20',
          )}
        >
          <Users size={22} /> Multiplayer
          <span className="absolute top-2 right-3 text-[10px] bg-emerald-400 text-black px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Beta</span>
        </button>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className={cn(
          'mt-20 text-[10px] uppercase tracking-[0.2em] font-bold',
          resolvedTheme === 'dark' ? 'text-gray-700' : 'text-gray-500',
        )}
      >
        A Game by TGS LABS
      </motion.p>
    </div>
  );
}

// ─── Level Select Screen ──────────────────────────────────────────────────────
function LevelSelectScreen({
  completedLevels,
  bestTimes,
  onSelectLevel,
  onBack,
  onStats,
  resolvedTheme,
}: {
  completedLevels: Set<number>;
  bestTimes: Record<number, number>;
  onSelectLevel: (level: number) => void;
  onBack: () => void;
  onStats: () => void;
  resolvedTheme: 'dark' | 'light';
}) {
  const dark = resolvedTheme === 'dark';
  const [activeTier, setActiveTier] = useState(0);
  const [filter, setFilter] = useState<LevelFilter>('all');

  const tier = TIERS[activeTier];
  const tierLevels = LEVEL_CONFIGS.filter(cfg => cfg.id >= tier.range[0] && cfg.id <= tier.range[1]);
  const visibleLevels = tierLevels.filter((cfg) => {
    const isCompleted = completedLevels.has(cfg.id);
    const isUnlocked = cfg.id === 1 || completedLevels.has(cfg.id - 1) || isCompleted;
    if (filter === 'completed') return isCompleted;
    if (filter === 'unlocked') return isUnlocked;
    return true;
  });

  return (
    <div className={cn('min-h-screen p-6 md:p-10', dark ? 'bg-[#0b0f17] text-white' : 'bg-[#f5f5f5] text-[#1a1a1a]')}>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-4 mb-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className={cn('p-3 rounded-xl transition-all active:scale-95', dark ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800')}
              aria-label="Back to menu"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Select Level</h1>
              <p className={cn('text-sm', dark ? 'text-gray-400' : 'text-gray-500')}>{completedLevels.size} / {MAX_LEVEL} completed</p>
            </div>
          </div>

          <button
            onClick={onStats}
            className={cn('px-4 py-3 rounded-xl border transition-all active:scale-95 flex items-center gap-2 font-bold text-sm', dark ? 'bg-white/10 border-white/10 hover:bg-white/15' : 'bg-white border-black/10 hover:bg-gray-50')}
          >
            <BarChart3 size={18} /> View Stats
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.5fr_1fr] mb-8">
          <div className={cn('rounded-3xl p-5 border shadow-sm', dark ? 'bg-white/5 border-white/10' : 'bg-white border-black/5')}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-3">Difficulty Bands</p>
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => setActiveTier((prev) => Math.max(0, prev - 1))}
                disabled={activeTier === 0}
                className={cn('p-2 rounded-xl border disabled:opacity-30', dark ? 'border-white/10 bg-white/5 hover:bg-white/10' : 'border-black/10 bg-white hover:bg-gray-50')}
                aria-label="Previous band"
              >
                <ChevronLeft size={18} />
              </button>
              <div className={cn('flex-1 rounded-2xl px-4 py-3 border', dark ? tier.darkBg : tier.bg, dark ? tier.darkBorder : tier.border)}>
                <p className={cn('text-[10px] uppercase tracking-[0.2em] font-bold mb-1', dark ? tier.darkText : tier.text)}>
                  Band {activeTier + 1}
                </p>
                <p className="text-xl font-black">{tier.name}</p>
                <p className={cn('text-sm', dark ? 'text-gray-400' : 'text-gray-500')}>Levels {tier.range[0]}-{tier.range[1]}</p>
              </div>
              <button
                onClick={() => setActiveTier((prev) => Math.min(TIERS.length - 1, prev + 1))}
                disabled={activeTier === TIERS.length - 1}
                className={cn('p-2 rounded-xl border disabled:opacity-30', dark ? 'border-white/10 bg-white/5 hover:bg-white/10' : 'border-black/10 bg-white hover:bg-gray-50')}
                aria-label="Next band"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {TIERS.map((item, index) => (
                <button
                  key={item.name}
                  onClick={() => setActiveTier(index)}
                  className={cn(
                    'px-3 py-2 rounded-full text-xs font-bold border transition-all',
                    index === activeTier
                      ? cn(dark ? item.darkBg : item.bg, dark ? item.darkBorder : item.border, dark ? item.darkText : item.text)
                      : dark ? 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10' : 'bg-white border-black/10 text-gray-500 hover:bg-gray-50'
                  )}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div className={cn('rounded-3xl p-5 shadow-xl', dark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-900 text-white')}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-bold mb-3">Visibility</p>
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                { key: 'all', label: 'All' },
                { key: 'unlocked', label: 'Unlocked' },
                { key: 'completed', label: 'Completed' },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setFilter(item.key as LevelFilter)}
                  className={cn(
                    'px-3 py-2 rounded-full text-xs font-bold transition-all',
                    filter === item.key ? 'bg-emerald-400 text-black' : 'bg-white/8 text-gray-300 hover:bg-white/12'
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-gray-300">{visibleLevels.length} levels visible in this band.</p>
            <p className="text-xs text-gray-500 mt-2">Use filters to focus on what is playable now or revisit completed clears.</p>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', tier.dot)} />
          <h2 className={cn('text-xs font-bold uppercase tracking-widest', dark ? tier.darkText : tier.text)}>{tier.name}</h2>
        </div>

        {visibleLevels.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {visibleLevels.map((cfg) => {
              const isCompleted = completedLevels.has(cfg.id);
              const isUnlocked = cfg.id === 1 || completedLevels.has(cfg.id - 1) || isCompleted;
              const subIndex = ((cfg.id - 1) % 10) + 1;
              const starRating = getLevelStarRating(cfg.id, bestTimes[cfg.id]);
              return (
                <button
                  key={cfg.id}
                  onClick={() => isUnlocked && onSelectLevel(cfg.id)}
                  disabled={!isUnlocked}
                  className={cn(
                    'relative p-4 rounded-2xl border-2 text-left transition-all min-h-28',
                    isUnlocked
                      ? cn(dark ? tier.darkBg : tier.bg, dark ? tier.darkBorder : tier.border, 'hover:shadow-md active:scale-95 cursor-pointer')
                      : dark ? 'bg-white/5 border-white/10 opacity-40 cursor-not-allowed' : 'bg-gray-100 border-gray-200 opacity-40 cursor-not-allowed'
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn('text-[10px] font-black', isUnlocked ? (dark ? tier.darkText : tier.text) : 'text-gray-400')}>
                      LV {cfg.id}
                    </span>
                    {isCompleted && (
                      <div className="flex items-center gap-0.5" aria-label={`${starRating} star rating`}>
                        {[1, 2, 3].map((star) => (
                          <Star
                            key={`${cfg.id}-star-${star}`}
                            size={11}
                            className={star <= starRating ? (dark ? tier.darkText : tier.text) : 'text-gray-300'}
                            fill={star <= starRating ? 'currentColor' : 'none'}
                          />
                        ))}
                      </div>
                    )}
                    {!isUnlocked && <Lock size={12} className="text-gray-400" />}
                  </div>
                  <p className="text-lg font-black leading-none mb-2">{subIndex}</p>
                  <p className={cn('text-[11px]', dark ? 'text-gray-400' : 'text-gray-500')}>
                    {cfg.width}x{cfg.height} board
                  </p>
                  <p className={cn('text-[11px]', dark ? 'text-gray-400' : 'text-gray-500')}>{cfg.timeSeconds}s timer</p>
                  {isCompleted && bestTimes[cfg.id] !== undefined && (
                    <p className={cn('text-[10px] font-bold mt-2', dark ? tier.darkText : tier.text)}>
                      Best {Math.floor(bestTimes[cfg.id] / 60)}:{String(bestTimes[cfg.id] % 60).padStart(2, '0')}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className={cn('border border-dashed rounded-3xl p-8 text-center', dark ? 'bg-white/5 border-white/10 text-gray-400' : 'bg-white border-black/10 text-gray-500')}>
            No levels match this filter in the current band.
          </div>
        )}
      </div>
    </div>
  );
}

function StatsScreen({
  completedLevels,
  bestTimes,
  playerStats,
  onBack,
  onPlay,
  resolvedTheme,
}: {
  completedLevels: Set<number>;
  bestTimes: Record<number, number>;
  playerStats: PlayerStats;
  onBack: () => void;
  onPlay: () => void;
  resolvedTheme: 'dark' | 'light';
}) {
  const dark = resolvedTheme === 'dark';
  const completedCount = completedLevels.size;
  const unlockedCount = Math.min(completedCount + 1, MAX_LEVEL);
  const completionPercent = Math.round((completedCount / MAX_LEVEL) * 100);
  const bestTimeValues = Object.values(bestTimes);
  const averageBest = bestTimeValues.length > 0
    ? Math.round(bestTimeValues.reduce((sum, value) => sum + value, 0) / bestTimeValues.length)
    : 0;
  const winRate = playerStats.gamesStarted > 0
    ? Math.round((playerStats.wins / playerStats.gamesStarted) * 100)
    : 0;
  const currentStreak = (() => {
    let streak = 0;
    for (let i = 1; i <= MAX_LEVEL; i++) {
      if (!completedLevels.has(i)) break;
      streak++;
    }
    return streak;
  })();

  const cardCn = dark ? 'bg-white/5 border-white/10' : 'bg-white border-black/5';

  return (
    <div className={cn('min-h-screen p-6 md:p-10', dark ? 'bg-[#0b0f17] text-white' : 'bg-[#f5f5f5] text-[#1a1a1a]')}>
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className={cn('p-3 rounded-xl transition-all active:scale-95', dark ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800')}
              aria-label="Back"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Player Stats</h1>
              <p className={cn('text-sm', dark ? 'text-gray-400' : 'text-gray-500')}>A quick read on progression, pace, and replay habits.</p>
            </div>
          </div>

          <button
            onClick={onPlay}
            className="px-5 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95"
          >
            Back to Levels
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-4 mb-8">
          <div className={cn('rounded-3xl p-5 border shadow-sm', cardCn)}>
            <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center mb-3', dark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700')}>
              <Target size={20} />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Completion</p>
            <p className="text-3xl font-black">{completionPercent}%</p>
            <p className={cn('text-sm mt-1', dark ? 'text-gray-400' : 'text-gray-500')}>{completedCount} of {MAX_LEVEL} levels cleared</p>
          </div>

          <div className={cn('rounded-3xl p-5 border shadow-sm', cardCn)}>
            <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center mb-3', dark ? 'bg-sky-500/20 text-sky-400' : 'bg-sky-100 text-sky-700')}>
              <Zap size={20} />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Best Pace</p>
            <p className="text-3xl font-black">{bestTimeValues.length}</p>
            <p className={cn('text-sm mt-1', dark ? 'text-gray-400' : 'text-gray-500')}>Completed levels with saved best times</p>
          </div>

          <div className={cn('rounded-3xl p-5 border shadow-sm', cardCn)}>
            <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center mb-3', dark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700')}>
              <Medal size={20} />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Win Rate</p>
            <p className="text-3xl font-black">{winRate}%</p>
            <p className={cn('text-sm mt-1', dark ? 'text-gray-400' : 'text-gray-500')}>{playerStats.wins} wins across {playerStats.gamesStarted} starts</p>
          </div>

          <div className={cn('rounded-3xl p-5 border shadow-sm', cardCn)}>
            <div className={cn('w-10 h-10 rounded-2xl flex items-center justify-center mb-3', dark ? 'bg-rose-500/20 text-rose-400' : 'bg-rose-100 text-rose-700')}>
              <Timer size={20} />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Time Played</p>
            <p className="text-3xl font-black">{formatDuration(playerStats.totalPlaySeconds)}</p>
            <p className={cn('text-sm mt-1', dark ? 'text-gray-400' : 'text-gray-500')}>Tracked from active in-level play</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
          <div className={cn('text-white rounded-[32px] p-6 shadow-2xl', dark ? 'bg-white/5 border border-white/10' : 'bg-gray-900')}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-bold mb-4">Progress Snapshot</p>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-300">Overall completion</span>
                  <span className="font-bold">{completedCount}/{MAX_LEVEL}</span>
                </div>
                <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${completionPercent}%` }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white/6 rounded-2xl p-4">
                  <p className="text-gray-500 mb-1">Current streak</p>
                  <p className="text-2xl font-black">{currentStreak}</p>
                </div>
                <div className="bg-white/6 rounded-2xl p-4">
                  <p className="text-gray-500 mb-1">Unlocked levels</p>
                  <p className="text-2xl font-black">{unlockedCount}</p>
                </div>
                <div className="bg-white/6 rounded-2xl p-4">
                  <p className="text-gray-500 mb-1">Hints used</p>
                  <p className="text-2xl font-black">{playerStats.hintsUsed}</p>
                </div>
                <div className="bg-white/6 rounded-2xl p-4">
                  <p className="text-gray-500 mb-1">Restarts</p>
                  <p className="text-2xl font-black">{playerStats.restarts}</p>
                </div>
              </div>
            </div>
          </div>

          <div className={cn('rounded-[32px] p-6 border shadow-sm', cardCn)}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-4">Session Details</p>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className={cn(dark ? 'text-gray-400' : 'text-gray-500')}>Games started</span>
                <span className="font-bold">{playerStats.gamesStarted}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className={cn(dark ? 'text-gray-400' : 'text-gray-500')}>Losses</span>
                <span className="font-bold">{playerStats.losses}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className={cn(dark ? 'text-gray-400' : 'text-gray-500')}>Average best time left</span>
                <span className="font-bold">{bestTimeValues.length ? formatDuration(averageBest) : 'No clears yet'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className={cn(dark ? 'text-gray-400' : 'text-gray-500')}>Latest unlocked level</span>
                <span className="font-bold">LV {unlockedCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArenaScreen({
  user,
  profile,
  phase,
  match,
  queueSeconds,
  countdown,
  onBack,
  onJoin,
  onLeave,
  onPlayAgain,
  resolvedTheme,
}: {
  user: CloudUser | null;
  profile: ArenaProfile | null;
  phase: 'idle' | 'queuing' | 'pregame' | 'playing' | 'submitting' | 'result';
  match: ArenaMatch | null;
  queueSeconds: number;
  countdown: number;
  onBack: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onPlayAgain: () => void;
  resolvedTheme: 'dark' | 'light';
}) {
  const rating = profile?.rating ?? user?.arenaRating ?? 1000;
  const tier = getArenaTier(rating);
  const isGuest = !user || user.provider === 'guest';
  const currentUserId = typeof user?.id === 'number' ? user.id : null;

  const formatWaitTime = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  };

  const isDark = resolvedTheme === 'dark';
  const pregameOpponentName = (() => {
    if (!match) return '...';
    if (match.player1.id === match.player2.id) return 'Invalid match';
    if (currentUserId !== null) {
      if (match.player1.id === currentUserId) return match.player2.displayName ?? 'Opponent';
      if (match.player2.id === currentUserId) return match.player1.displayName ?? 'Opponent';
    }
    return 'Opponent';
  })();

  return (
    <div className={cn('min-h-screen p-6 md:p-10', isDark ? 'bg-[#0b0f17] text-white' : 'bg-[#f5f5f5] text-[#1a1a1a]')}>
      <div className="max-w-6xl mx-auto">
        <div className="w-full flex items-center mb-8">
          <button onClick={onBack} className={cn('p-3 rounded-xl transition-all active:scale-95', isDark ? 'bg-white/10 hover:bg-white/15 border border-white/10' : 'bg-black text-white hover:bg-gray-800')}>
            <ChevronLeft size={22} />
          </button>
          <h1 className="text-3xl font-black ml-3 tracking-tight">Arena</h1>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className={cn('w-full rounded-3xl p-6 mb-6 border-2', tier.bg, tier.border)}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] font-bold text-gray-600 mb-1">Rating</p>
                  <p className="text-5xl font-black text-gray-900">{rating}</p>
                </div>
                <div className={cn('px-4 py-2 rounded-2xl font-bold text-sm border bg-white/70 text-gray-900', tier.border)}>
                  {tier.name}
                </div>
              </div>
              {profile && (
                <div className="grid grid-cols-3 gap-3 text-center text-sm">
                  <div>
                    <p className="font-black text-gray-900">{profile.matchesPlayed}</p>
                    <p className="text-gray-600 text-xs font-semibold">Played</p>
                  </div>
                  <div>
                    <p className="font-black text-emerald-800">{profile.wins}</p>
                    <p className="text-gray-600 text-xs font-semibold">Wins</p>
                  </div>
                  <div>
                    <p className="font-black text-red-700">{profile.losses}</p>
                    <p className="text-gray-600 text-xs font-semibold">Losses</p>
                  </div>
                </div>
              )}
            </div>

            <div className={cn('w-full border rounded-2xl p-4 mb-6', isDark ? 'bg-white/5 border-white/10' : 'bg-white border-black/10')}>
              <p className="text-xs uppercase tracking-[0.2em] font-bold text-gray-400 mb-3">Tier Ladder</p>
              <div className="space-y-2">
                {[...ARENA_TIERS].reverse().map((t) => {
                  const isActive = t.name === tier.name;
                  return (
                    <div key={t.name} className={cn('flex items-center justify-between text-sm px-3 py-1.5 rounded-xl', isActive ? cn(t.bg, 'font-bold') : '')}>
                      <span className={isActive ? t.color : (isDark ? t.darkColor : t.color)}>{t.name}</span>
                      <span className={cn('text-xs font-semibold',
                        isActive
                          ? 'text-gray-700'
                          : (isDark ? 'text-gray-400' : 'text-gray-500')
                      )}>{t.minRating}+</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <div className={cn('rounded-3xl p-6 border shadow-sm', isDark ? 'bg-white/5 border-white/10' : 'bg-white border-black/10')}>
              {phase === 'idle' && (
                isGuest ? (
                  <div className={cn('w-full text-center p-6 rounded-2xl border', isDark ? 'bg-amber-500/10 border-amber-300/30 text-amber-200' : 'bg-amber-50 border-amber-200 text-amber-800')}>
                    <p className="font-bold mb-1">Sign in to play Arena</p>
                    <p className="text-sm opacity-90">Guest accounts cannot join ranked matches.</p>
                  </div>
                ) : (
                  <button
                    onClick={onJoin}
                    className="w-full py-5 bg-gradient-to-r from-red-500 to-orange-500 text-white rounded-2xl font-bold text-lg hover:from-red-600 hover:to-orange-600 transition-all shadow-lg"
                  >
                    <Swords className="inline mr-2 mb-0.5" size={20} />
                    Find Match
                  </button>
                )
              )}

              {phase === 'queuing' && (
                <div className="w-full text-center">
                  <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="font-bold text-lg mb-1">Finding Opponent...</p>
                  <p className={cn('text-sm mb-6', isDark ? 'text-gray-300' : 'text-gray-500')}>{formatWaitTime(queueSeconds)} in queue</p>
                  <button
                    onClick={onLeave}
                    className={cn('w-full py-3 border-2 rounded-2xl font-bold transition-all', isDark ? 'border-white/20 text-gray-200 hover:border-white/40' : 'border-gray-200 text-gray-600 hover:border-gray-400')}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {phase === 'pregame' && match && (
                <div className="w-full text-center">
                  <p className={cn('mb-2', isDark ? 'text-gray-300' : 'text-gray-500')}>vs {pregameOpponentName}</p>
                  <div className="text-7xl font-black mb-4">{countdown}</div>
                  <p className={cn('text-sm', isDark ? 'text-gray-400' : 'text-gray-500')}>Match starting...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MultiplayerScreen({
  user,
  onBack,
  onStartChallenge,
  onGuestBootstrap,
  onGuestNicknameUpdate,
  multiplayerStats,
  resolvedTheme,
  onToast,
}: {
  user: CloudUser | null;
  onBack: () => void;
  onStartChallenge: (snapshot: MultiplayerRoomSnapshot) => Promise<void>;
  onGuestBootstrap: () => Promise<boolean>;
  onGuestNicknameUpdate: (nickname: string) => Promise<void>;
  multiplayerStats: MultiplayerStats | null;
  resolvedTheme: 'dark' | 'light';
  onToast: (message: string, tone?: ToastTone) => void;
}) {
  const [difficulty, setDifficulty] = useState<RoomDifficulty>('moderate');
  const [totalRounds, setTotalRounds] = useState(3);
  const [joinCode, setJoinCode] = useState('');
  const [guestNickname, setGuestNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomSnapshot, setRoomSnapshot] = useState<MultiplayerRoomSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<MultiplayerChallengeSnapshot | null>(null);
  const [waitingForOtherReady, setWaitingForOtherReady] = useState(false);
  const launchedChallengeKeyRef = useRef<string | null>(null);
  const prevLobbyPlayerCountRef = useRef<number | null>(null);

  const selectedDifficulty = ROOM_DIFFICULTY_OPTIONS.find((option) => option.value === difficulty) ?? ROOM_DIFFICULTY_OPTIONS[1];
  const difficultyStartLevel = selectedDifficulty.startLevel;
  const difficultyEndLevel = Math.min(MAX_LEVEL, difficultyStartLevel + totalRounds - 1);

  useEffect(() => {
    if (user?.provider === 'guest') {
      setGuestNickname(user.displayName.replace(/\s*\(Guest\)\s*$/i, '').trim());
    } else {
      setGuestNickname('');
    }
  }, [user?.displayName, user?.provider]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room') ?? params.get('challenge');
    if (!code) return;
    setJoinCode(sanitizeCode(code));
  }, []);

  useEffect(() => {
    launchedChallengeKeyRef.current = null;
    prevLobbyPlayerCountRef.current = null;
  }, [roomSnapshot?.room.code]);

  useEffect(() => {
    const currentCount = roomSnapshot?.players.length ?? null;
    if (currentCount === null) return;
    const prevCount = prevLobbyPlayerCountRef.current;
    if (prevCount !== null && currentCount > prevCount) {
      playSoundCue('player_joined');
    }
    prevLobbyPlayerCountRef.current = currentCount;
  }, [roomSnapshot?.players.length]);

  const sanitizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const syncRoomUrl = (code: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    window.history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
  };

  const mapRoomToChallengeSnapshot = useCallback((data: MultiplayerRoomSnapshot): MultiplayerChallengeSnapshot => {
    const round = data.activeRound;
    const submissions = new Map((round?.submissions ?? []).map((submission) => [submission.userId, submission]));
    const roundWinnerUserId = round?.submissions.find((submission) => submission.placement === 1)?.userId ?? null;
    const players = data.players.map((player) => {
      const submission = submissions.get(player.userId);
      const status: 'joined' | 'submitted' = submission ? 'submitted' : 'joined';
      const didFinish = submission?.didFinish ?? null;
      return {
        userId: player.userId,
        displayName: player.displayName,
        provider: player.provider,
        joinedAt: player.joinedAt,
        readyAt: null,
        status,
        didWin: submission ? (didFinish ? submission.placement === 1 : false) : null,
        didFinish,
        placement: submission?.placement ?? null,
        elapsedSeconds: submission ? (didFinish ? submission.elapsedSeconds : null) : null,
        remainingSeconds: submission ? (didFinish ? submission.remainingSeconds : null) : null,
        submittedAt: submission ? submission.submittedAt : null,
      };
    });
    return {
      challenge: {
        id: data.room.id,
        code: data.room.code,
        levelId: round?.levelId ?? data.room.levelId,
        puzzleSeed: round?.puzzleSeed ?? '',
        isRanked: data.room.isRanked,
        status: data.room.status === 'finished' ? 'closed' : 'open',
        startAt: round?.startAt ?? null,
        winnerUserId: roundWinnerUserId,
        endedAt: round?.endedAt ?? null,
        createdAt: data.room.createdAt,
        updatedAt: data.room.updatedAt,
        closedAt: data.room.closedAt,
        creator: {
          id: data.room.host.id,
          displayName: data.room.host.displayName,
          provider: data.room.host.provider,
        },
      },
      players,
    };
  }, []);

  const shareLink = snapshot
    ? `${window.location.origin}/?room=${snapshot.challenge.code}`
    : null;
  const readyTarget = roomSnapshot?.room.maxPlayers ?? 8;
  const playerCount = snapshot?.players.length ?? 0;
  const readyCount = snapshot?.players.filter((player) => player.status === 'ready' || player.status === 'submitted').length ?? 0;
  const readyPercent = Math.round((Math.min(readyCount, readyTarget) / readyTarget) * 100);
  const readinessLabel = playerCount < readyTarget
    ? `Players ${playerCount}/${readyTarget}`
    : `Ready ${readyCount}/${readyTarget}`;
  const isHost = Boolean(user && roomSnapshot && roomSnapshot.room.host.id === user.id);
  const isDark = resolvedTheme === 'dark';

  const canUseMultiplayer = Boolean(user);

  const launchChallengeIfStarted = useCallback(async (nextSnapshot: MultiplayerRoomSnapshot) => {
    const startAt = nextSnapshot.activeRound?.startAt ?? null;
    if (!startAt) return;
    if (user && nextSnapshot.activeRound?.submissions.some((submission) => submission.userId === user.id)) return;
    const launchKey = `${nextSnapshot.room.code}:${nextSnapshot.activeRound?.roundNumber ?? 0}:${startAt}`;
    if (launchedChallengeKeyRef.current === launchKey) return;
    launchedChallengeKeyRef.current = launchKey;
    setWaitingForOtherReady(false);
    setLaunching(true);
    try {
      await onStartChallenge(nextSnapshot);
    } catch (err) {
      launchedChallengeKeyRef.current = null;
      setError(authErrorToMessage(err));
    } finally {
      setLaunching(false);
    }
  }, [onStartChallenge, user]);

  const ensureMultiplayerAuth = async () => {
    if (canUseMultiplayer) return true;
    const ok = await onGuestBootstrap();
    if (!ok) {
      setError('Please sign in first to use cloud multiplayer.');
      return false;
    }
    onToast('Guest multiplayer session connected.', 'success');
    return true;
  };

  const handleCreate = async () => {
    const ready = await ensureMultiplayerAuth();
    if (!ready) return;
    try {
      setLoading(true);
      setError(null);
      const data = await createMultiplayerRoom({ difficulty, totalRounds, maxPlayers: 8 });
      setRoomSnapshot(data);
      setSnapshot(mapRoomToChallengeSnapshot(data));
      setJoinCode(data.room.code);
      syncRoomUrl(data.room.code);
      setWaitingForOtherReady(false);
      onToast(`Room ${data.room.code} created.`, 'success');
      trackEvent('multiplayer_room_created', {
        code: data.room.code,
        difficulty,
        start_level: difficultyStartLevel,
        rounds: totalRounds,
      });
    } catch (err) {
      setError(authErrorToMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    const code = sanitizeCode(joinCode);
    const ready = await ensureMultiplayerAuth();
    if (!ready) return;
    if (!code) {
      setError('Please enter a challenge code.');
      return;
    }
    try {
      setLoading(true);
      setError(null);
      if (user?.provider === 'guest' && guestNickname.trim()) {
        await onGuestNicknameUpdate(guestNickname.trim());
      }
      const data = await joinMultiplayerRoom(code);
      setRoomSnapshot(data);
      setSnapshot(mapRoomToChallengeSnapshot(data));
      setJoinCode(data.room.code);
      syncRoomUrl(data.room.code);
      setWaitingForOtherReady(data.room.status === 'open');
      onToast(`Joined room ${data.room.code}.`, 'success');
      trackEvent('multiplayer_room_joined', { code: data.room.code });
    } catch (err) {
      setError(authErrorToMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    const code = roomSnapshot?.room.code ?? sanitizeCode(joinCode);
    if (!code) return;
    try {
      setLoading(true);
      setError(null);
      const data = await fetchMultiplayerRoom(code);
      setRoomSnapshot(data);
      setSnapshot(mapRoomToChallengeSnapshot(data));
      setJoinCode(data.room.code);
      syncRoomUrl(data.room.code);
      await launchChallengeIfStarted(data);
    } catch (err) {
      setError(authErrorToMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      onToast('Challenge link copied.', 'success');
    } catch {
      onToast('Copy failed. You can copy it manually.', 'warning');
    }
  };

  const handleReadyAndPlay = async () => {
    if (!snapshot) return;
    const ready = await ensureMultiplayerAuth();
    if (!ready) return;
    try {
      setLoading(true);
      setError(null);
      if (!roomSnapshot) return;
      const started = await startMultiplayerRoom(roomSnapshot.room.code);
      setRoomSnapshot(started);
      setSnapshot(mapRoomToChallengeSnapshot(started));
      setJoinCode(started.room.code);
      syncRoomUrl(started.room.code);
      if (started.activeRound?.startAt) {
        await launchChallengeIfStarted(started);
      } else {
        setWaitingForOtherReady(true);
        onToast('Waiting for host to start.', 'neutral');
      }
    } catch (err) {
      setError(authErrorToMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const code = roomSnapshot?.room.code;
    if (!code) return;
    let active = true;

    const poll = async () => {
      try {
        const data = await fetchMultiplayerRoom(code);
        if (!active) return;
        setRoomSnapshot(data);
        setSnapshot(mapRoomToChallengeSnapshot(data));
        setJoinCode(data.room.code);
        syncRoomUrl(data.room.code);
        if (data.room.status === 'open' && (!isHost) && data.players.length >= 2) {
          setWaitingForOtherReady(true);
        }
        if (data.activeRound?.startAt) {
          await launchChallengeIfStarted(data);
        }
      } catch (err) {
        if (active) {
          setError(authErrorToMessage(err));
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, roomSnapshot?.room.status === 'in_progress' ? 900 : 1500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [isHost, launchChallengeIfStarted, mapRoomToChallengeSnapshot, roomSnapshot?.room.code, roomSnapshot?.room.status]);

  return (
    <div className={cn('min-h-screen p-6 md:p-10', isDark ? 'bg-[#0b0f17] text-white' : 'bg-[#f5f5f5] text-[#1a1a1a]')}>
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className={cn(
                'p-3 rounded-xl transition-all active:scale-95',
                isDark ? 'bg-white/10 text-white border border-white/10 hover:bg-white/15' : 'bg-black text-white hover:bg-gray-800',
              )}
              aria-label="Back"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Multiplayer Rooms</h1>
              <p className={cn('text-sm', isDark ? 'text-gray-300' : 'text-gray-500')}>Create rooms up to 8 players and race for multi-round points.</p>
            </div>
          </div>
        </div>

        {!canUseMultiplayer && (
          <div className={cn('mb-5 rounded-2xl border p-4 text-sm', isDark ? 'border-amber-300/35 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800')}>
            You can play multiplayer as guest. Rooms with any guest are marked unranked.
            <button
              onClick={() => void onGuestBootstrap()}
              className={cn(
                'ml-2 inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                isDark ? 'bg-white/15 text-white hover:bg-white/25 border border-white/15' : 'bg-black text-white hover:bg-gray-800',
              )}
            >
              Continue as Guest
            </button>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className={cn('rounded-3xl p-6 border shadow-sm', isDark ? 'bg-[#151a25] border-white/10' : 'bg-white border-black/5')}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-3">Create Room</p>
            <label className={cn('text-xs font-bold uppercase tracking-[0.15em]', isDark ? 'text-gray-300' : 'text-gray-500')}>Difficulty</label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as RoomDifficulty)}
              className={cn('mt-2 w-full mb-3 px-3 py-2 rounded-lg border text-sm', isDark ? 'bg-white/5 border-white/15 text-white' : 'bg-white border-black/10 text-black')}
            >
              {ROOM_DIFFICULTY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} (starts at Level {option.startLevel})
                </option>
              ))}
            </select>
            <p className={cn('mb-4 text-xs', isDark ? 'text-gray-300' : 'text-gray-500')}>
              Round levels will run from {difficultyStartLevel} to {difficultyEndLevel}.
            </p>
            <label className={cn('text-xs font-bold uppercase tracking-[0.15em]', isDark ? 'text-gray-300' : 'text-gray-500')}>Rounds (1-10)</label>
            <input
              type="number"
              min={1}
              max={10}
              value={totalRounds}
              onChange={(e) => setTotalRounds(Math.min(10, Math.max(1, Number(e.target.value || 1))))}
              className={cn('mt-2 w-full mb-4 px-3 py-2 rounded-lg border text-sm', isDark ? 'bg-white/5 border-white/15 text-white' : 'bg-white border-black/10 text-black')}
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={loading}
                className={cn('flex-1 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 transition-all', isDark ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800')}
              >
                {loading ? 'Working...' : 'Create Room'}
              </button>
            </div>
          </div>

          <div className={cn('rounded-3xl p-6 border shadow-sm', isDark ? 'bg-[#151a25] border-white/10' : 'bg-white border-black/5')}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-3">Join Room</p>
            {user?.provider === 'guest' && (
              <>
                <label className={cn('text-xs font-bold uppercase tracking-[0.15em]', isDark ? 'text-gray-300' : 'text-gray-500')}>Nickname (Guest)</label>
                <input
                  type="text"
                  value={guestNickname}
                  onChange={(e) => setGuestNickname(e.target.value.slice(0, 24))}
                  placeholder="Your name"
                  className={cn('mt-2 w-full mb-3 px-3 py-2 rounded-lg border text-sm', isDark ? 'bg-white/5 border-white/15 text-white placeholder:text-gray-400' : 'bg-white border-black/10 text-black')}
                />
                <p className={cn('mb-3 text-[11px]', isDark ? 'text-gray-300' : 'text-gray-500')}>
                  Displayed as <span className="font-semibold">{(guestNickname.trim() || 'Guest')} (Guest)</span>
                </p>
              </>
            )}
            <label className={cn('text-xs font-bold uppercase tracking-[0.15em]', isDark ? 'text-gray-300' : 'text-gray-500')}>Code</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(sanitizeCode(e.target.value))}
              placeholder="EXAMPLE: A1B2C3D4"
              className={cn('mt-2 w-full mb-4 px-3 py-2 rounded-lg border text-sm uppercase tracking-wider', isDark ? 'bg-white/5 border-white/15 text-white placeholder:text-gray-400' : 'bg-white border-black/10 text-black')}
            />
            <button
              onClick={handleJoin}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-emerald-500 text-black text-sm font-bold hover:bg-emerald-400 disabled:opacity-50"
            >
              {loading ? 'Working...' : 'Join Room'}
            </button>
          </div>
        </div>

        {error && (
          <div className={cn('mt-4 rounded-2xl border p-4 text-sm', isDark ? 'border-red-300/30 bg-red-500/10 text-red-200' : 'border-red-200 bg-red-50 text-red-700')}>
            {error}
          </div>
        )}

        {snapshot && (
          <div className={cn('mt-6 rounded-[32px] p-6 shadow-2xl border', isDark ? 'bg-[#151a25] text-white border-white/10' : 'bg-white text-[#1a1a1a] border-black/10')}>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-bold mb-1">Active Room</p>
                <h2 className="text-2xl font-black flex items-center gap-2">
                  <Link2 size={20} />
                  {snapshot.challenge.code}
                </h2>
                <p className={cn('text-sm mt-1', isDark ? 'text-gray-300' : 'text-gray-600')}>
                  Level {snapshot.challenge.levelId} | {snapshot.challenge.status.toUpperCase()} | {snapshot.challenge.isRanked ? 'RANKED' : 'UNRANKED'}
                </p>
                {roomSnapshot && (
                  <p className={cn('text-xs mt-1', isDark ? 'text-gray-400' : 'text-gray-500')}>
                    {ROOM_DIFFICULTY_OPTIONS.find((option) => option.value === roomSnapshot.room.difficulty)?.label ?? 'Moderate'} | Round {Math.max(1, roomSnapshot.room.currentRound)}/{roomSnapshot.room.totalRounds} | Players {roomSnapshot.players.length}/{roomSnapshot.room.maxPlayers}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRefresh}
                  disabled={loading || launching}
                  className={cn('px-3 py-2 rounded-xl text-xs font-bold transition-all', isDark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-800')}
                >
                  Refresh
                </button>
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 rounded-xl bg-emerald-400 text-black text-xs font-bold hover:bg-emerald-300 flex items-center gap-1"
                >
                  <Copy size={14} /> Copy Link
                </button>
                {isHost && roomSnapshot?.room.status === 'open' && (
                  <button
                    onClick={() => { void handleReadyAndPlay(); }}
                    disabled={loading || launching || (roomSnapshot?.players.length ?? 0) < 2}
                    className={cn('px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-60 transition-all', isDark ? 'bg-white text-black hover:bg-gray-100' : 'bg-black text-white hover:bg-gray-800')}
                  >
                    {loading || launching ? 'Working...' : 'Start Tournament'}
                  </button>
                )}
              </div>
            </div>

            {waitingForOtherReady && !snapshot.challenge.startAt && (
              <div className={cn('mb-4 rounded-xl border px-3 py-2 text-xs', isDark ? 'border-amber-300/35 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800')}>
                Waiting for host to start the tournament.
              </div>
            )}

            {!snapshot.challenge.startAt && (
              <div className={cn('mb-4 rounded-xl border px-3 py-3', isDark ? 'border-white/15 bg-white/5' : 'border-black/10 bg-gray-50')}>
                <div className={cn('flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em] mb-2', isDark ? 'text-gray-300' : 'text-gray-600')}>
                  <span>Pre-Match Ready</span>
                  <span>{readinessLabel}</span>
                </div>
                <div className={cn('h-2 w-full rounded-full overflow-hidden', isDark ? 'bg-white/15' : 'bg-black/10')}>
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all duration-300"
                    style={{ width: `${readyPercent}%` }}
                  />
                </div>
              </div>
            )}

            {shareLink && (
              <div className={cn('mb-5 p-3 rounded-xl text-xs break-all', isDark ? 'bg-white/6 text-gray-300' : 'bg-gray-100 text-gray-700')}>
                {shareLink}
              </div>
            )}

            <div className="grid gap-2">
              {snapshot.players.map((player) => (
                <div key={player.userId} className={cn('rounded-2xl px-4 py-3 flex items-center justify-between', isDark ? 'bg-white/6' : 'bg-gray-100')}>
                  <div>
                    <p className="font-bold">{player.displayName}</p>
                    <p className={cn('text-xs', isDark ? 'text-gray-400' : 'text-gray-500')}>
                      {player.provider}
                      {' '}
                      |
                      {' '}
                      {player.status === 'ready' ? 'Ready' : player.status === 'submitted' ? 'Finished' : 'Waiting'}
                    </p>
                  </div>
                  <div className={cn('text-right text-xs', isDark ? 'text-gray-300' : 'text-gray-600')}>
                    {player.elapsedSeconds !== null ? (
                      <p>Elapsed: {player.elapsedSeconds}s</p>
                    ) : (
                      <p>Waiting result...</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {roomSnapshot && (
              <div className={cn('mt-4 rounded-2xl border p-4', isDark ? 'border-white/15 bg-white/5' : 'border-black/10 bg-gray-50')}>
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Leaderboard</p>
                <div className="space-y-1 text-sm">
                  {roomSnapshot.players.map((player, idx) => (
                    <div key={player.userId} className="flex items-center justify-between">
                      <span className={cn('font-semibold', isDark ? 'text-gray-100' : 'text-gray-700')}>{idx + 1}. {player.displayName}</span>
                      <span className={cn('font-bold', isDark ? 'text-emerald-300' : 'text-emerald-700')}>{player.totalPoints} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {roomSnapshot?.activeRound && (
              <div className={cn('mt-4 rounded-xl border px-3 py-3', isDark ? 'border-white/15 bg-white/5' : 'border-black/10 bg-gray-50')}>
                <div className={cn('flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em] mb-2', isDark ? 'text-gray-300' : 'text-gray-600')}>
                  <span>Round Progress</span>
                  <span>{roomSnapshot.activeRound.submissions.length}/{roomSnapshot.players.length} Submitted</span>
                </div>
                <div className={cn('h-2 w-full rounded-full overflow-hidden', isDark ? 'bg-white/15' : 'bg-black/10')}>
                  <div
                    className="h-full bg-sky-400 rounded-full transition-all duration-300"
                    style={{ width: `${roomSnapshot.players.length > 0 ? Math.round((roomSnapshot.activeRound.submissions.length / roomSnapshot.players.length) * 100) : 0}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {user && user.provider !== 'guest' && multiplayerStats && (
          <div className={cn('mt-6 rounded-3xl p-6 border shadow-sm', isDark ? 'bg-[#151a25] border-white/10' : 'bg-white border-black/5')}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-3">Multiplayer Stats</p>
            <div className="grid gap-2 md:grid-cols-4 text-sm">
              <div className={cn('rounded-xl px-3 py-2', isDark ? 'bg-white/5' : 'bg-gray-50')}>
                <p className={cn(isDark ? 'text-gray-300' : 'text-gray-500')}>Matches</p>
                <p className="text-xl font-black">{multiplayerStats.matchesPlayed}</p>
              </div>
              <div className={cn('rounded-xl px-3 py-2', isDark ? 'bg-white/5' : 'bg-gray-50')}>
                <p className={cn(isDark ? 'text-gray-300' : 'text-gray-500')}>Wins</p>
                <p className="text-xl font-black">{multiplayerStats.wins}</p>
              </div>
              <div className={cn('rounded-xl px-3 py-2', isDark ? 'bg-white/5' : 'bg-gray-50')}>
                <p className={cn(isDark ? 'text-gray-300' : 'text-gray-500')}>Losses</p>
                <p className="text-xl font-black">{multiplayerStats.losses}</p>
              </div>
              <div className={cn('rounded-xl px-3 py-2', isDark ? 'bg-white/5' : 'bg-gray-50')}>
                <p className={cn(isDark ? 'text-gray-300' : 'text-gray-500')}>Best Time</p>
                <p className="text-xl font-black">
                  {multiplayerStats.bestElapsedSeconds !== null ? `${multiplayerStats.bestElapsedSeconds}s` : '-'}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ToastLayer({ toasts }: { toasts: ToastMessage[] }) {
  const toneClasses: Record<ToastTone, string> = {
    neutral: 'bg-gray-900 text-white',
    success: 'bg-emerald-500 text-black',
    warning: 'bg-amber-400 text-black',
  };

  return (
    <div className="fixed top-6 right-6 z-[80] flex flex-col gap-3 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            className={cn('px-4 py-3 rounded-2xl shadow-xl font-bold text-sm max-w-xs', toneClasses[toast.tone])}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Error Modal ──────────────────────────────────────────────────────────────
function ConsentBanner({
  onAcceptPersonalized,
  onAcceptEssential,
}: {
  onAcceptPersonalized: () => void;
  onAcceptEssential: () => void;
}) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[85] w-full max-w-3xl px-4">
      <div className="rounded-3xl border border-black/10 bg-white shadow-2xl p-5 md:p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Privacy and Cookies</p>
        <p className="text-sm text-gray-600 mb-4">
          PentaBlocks stores gameplay progress in your browser and may use analytics or ads after launch.
          By continuing, you accept essential storage usage.
        </p>
        <p className="text-xs text-gray-500 mb-4">
          Read the details in our
          {' '}
          <a href="/privacy.html" target="_blank" rel="noreferrer" className="font-bold underline">Privacy Policy</a>
          {' '}
          and
          {' '}
          <a href="/terms.html" target="_blank" rel="noreferrer" className="font-bold underline">Terms</a>.
        </p>
        <div className="flex flex-col md:flex-row gap-2">
          <button
            onClick={onAcceptPersonalized}
            className="flex-1 px-4 py-3 rounded-xl bg-black text-white font-bold hover:bg-gray-800 transition-all"
          >
            Accept All
          </button>
          <button
            onClick={onAcceptEssential}
            className="flex-1 px-4 py-3 rounded-xl border border-black/10 bg-white text-gray-700 font-bold hover:bg-gray-50 transition-all"
          >
            Essential Only
          </button>
        </div>
      </div>
    </div>
  );
}

function AdBreakModal({
  isOpen,
  onContinue,
}: {
  isOpen: boolean;
  onContinue: () => void;
}) {
  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[75] flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.95, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-white rounded-3xl p-8 max-w-md w-full text-center shadow-2xl border border-black/5"
      >
        <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-3">Ad Break</p>
        <h3 className="text-2xl font-black mb-2">Monetization Placeholder</h3>
        <p className="text-sm text-gray-500 mb-6">
          This is where your ad provider interstitial will appear.
          First session stays ad-free, then one break every few completed levels.
        </p>
        <button
          onClick={onContinue}
          className="w-full py-3 rounded-xl bg-black text-white font-bold hover:bg-gray-800 transition-all"
        >
          Continue
        </button>
      </motion.div>
    </motion.div>
  );
}

function AccountPanel({
  user,
  authLoading,
  authError,
  syncStateLabel,
  googleEnabled,
  googleSlotRef,
  resolvedTheme,
  onGuestLogin,
  onNicknameLogin,
  onNicknameRegister,
  onLogout,
}: {
  user: CloudUser | null;
  authLoading: boolean;
  authError: string | null;
  syncStateLabel: string;
  googleEnabled: boolean;
  googleSlotRef: React.RefObject<HTMLDivElement | null>;
  resolvedTheme: 'dark' | 'light';
  onGuestLogin: (nickname?: string) => Promise<boolean>;
  onNicknameLogin: (params: { nickname: string; password: string }) => void;
  onNicknameRegister: (nickname: string, password: string) => void;
  onLogout: () => void;
}) {
  const [guestNickname, setGuestNickname] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [nicknameMode, setNicknameMode] = useState<'signin' | 'register'>('register');
  const [nicknameSubmitAttempted, setNicknameSubmitAttempted] = useState(false);
  const normalizedNicknamePreview = nickname
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 24);
  const nicknameLooksValid = normalizedNicknamePreview.length >= 3;
  const passwordLooksValid = password.length >= 8;
  const isDark = resolvedTheme === 'dark';

  const submitAccount = () => {
    setNicknameSubmitAttempted(true);
    const trimmedNickname = nickname.trim();
    if (!nicknameLooksValid || !passwordLooksValid) {
      return;
    }
    if (nicknameMode === 'signin') {
      onNicknameLogin({ nickname: trimmedNickname, password });
      return;
    }
    onNicknameRegister(trimmedNickname, password);
  };

  return (
    <div className="w-full">
      <div className={cn('rounded-3xl shadow-xl p-4 border', isDark ? 'bg-[#151a25] border-white/10' : 'bg-white border-black/10')}>
        <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Cloud Profile</p>

        {user ? (
          <>
            <p className={cn('text-sm mb-1', isDark ? 'text-gray-300' : 'text-gray-600')}>Signed in as</p>
            <p className={cn('text-base font-black', isDark ? 'text-white' : 'text-black')}>{user.displayName}</p>
            <p className={cn('text-xs mb-3', isDark ? 'text-gray-400' : 'text-gray-500')}>
              {user.provider === 'google'
                ? 'Google account'
                : user.provider === 'nickname'
                  ? 'Nickname account'
                  : user.provider === 'email'
                    ? 'Email account'
                    : 'Guest cloud account'}
            </p>
            <p className={cn('text-xs font-bold mb-3', isDark ? 'text-emerald-300' : 'text-emerald-700')}>{syncStateLabel}</p>
            <button
              onClick={onLogout}
              className={cn('w-full py-2.5 rounded-xl text-sm font-bold transition-all border', isDark ? 'border-white/20 text-gray-200 hover:bg-white/10' : 'border-black/10 text-gray-700 hover:bg-gray-50')}
            >
              Sign Out
            </button>
          </>
        ) : (
          <>
            {authLoading && (
              <p className={cn('text-xs mb-2', isDark ? 'text-gray-300' : 'text-gray-500')}>Checking previous session...</p>
            )}
            <p className={cn('text-sm mb-3', isDark ? 'text-gray-300' : 'text-gray-600')}>
              Sign in to keep levels and stats across devices.
            </p>
            <button
              onClick={() => void onGuestLogin(guestNickname.trim() || undefined)}
              className={cn('w-full py-2.5 rounded-xl text-sm font-bold transition-all mb-2', isDark ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800')}
            >
              Continue as Guest
            </button>
            <input
              type="text"
              value={guestNickname}
              onChange={(e) => setGuestNickname(e.target.value)}
              placeholder="Optional nickname for guest"
              className={cn('w-full mb-2 px-3 py-2 rounded-lg border text-sm', isDark ? 'border-white/15 bg-white/5 text-white placeholder:text-gray-400' : 'border-black/10 bg-white text-black')}
            />
            <div className={cn('mt-2 border rounded-2xl p-3', isDark ? 'border-white/10 bg-white/5' : 'border-black/10 bg-gray-50/60')}>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => {
                    setNicknameMode('register');
                    setNicknameSubmitAttempted(false);
                  }}
                  className={cn(
                    'flex-1 text-xs font-bold rounded-lg py-1.5',
                    nicknameMode === 'register'
                      ? (isDark ? 'bg-white text-black' : 'bg-black text-white')
                      : (isDark ? 'bg-[#1a2130] text-gray-200 border border-white/15' : 'bg-white text-gray-600 border border-black/10'),
                  )}
                >
                  Create Nickname
                </button>
                <button
                  onClick={() => {
                    setNicknameMode('signin');
                    setNicknameSubmitAttempted(false);
                  }}
                  className={cn(
                    'flex-1 text-xs font-bold rounded-lg py-1.5',
                    nicknameMode === 'signin'
                      ? (isDark ? 'bg-white text-black' : 'bg-black text-white')
                      : (isDark ? 'bg-[#1a2130] text-gray-200 border border-white/15' : 'bg-white text-gray-600 border border-black/10'),
                  )}
                >
                  Sign In
                </button>
              </div>
              <input
                type="text"
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                  if (nicknameSubmitAttempted) setNicknameSubmitAttempted(false);
                }}
                placeholder="Choose a nickname"
                className={cn('w-full mb-2 px-3 py-2 rounded-lg border text-sm', isDark ? 'border-white/15 bg-white/5 text-white placeholder:text-gray-400' : 'border-black/10 bg-white text-black')}
              />
              {(nicknameSubmitAttempted || nickname.trim().length > 0) && normalizedNicknamePreview && (
                <p className="mt-1">
                  Saved as:
                  {' '}
                  <span className={cn('font-bold', isDark ? 'text-white' : 'text-black')}>{normalizedNicknamePreview || 'nickname-preview'}</span>
                </p>
              )}
              {nicknameSubmitAttempted && !nicknameLooksValid && (
                <p className="mb-2 text-[11px] font-semibold text-amber-700">
                  Rules: at least 3 chars, letters/numbers, and `.` `_` `-` allowed.
                </p>
              )}
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (nicknameSubmitAttempted) setNicknameSubmitAttempted(false);
                }}
                placeholder="Password (min 8 chars)"
                className={cn('w-full mb-2 px-3 py-2 rounded-lg border text-sm', isDark ? 'border-white/15 bg-white/5 text-white placeholder:text-gray-400' : 'border-black/10 bg-white text-black')}
              />
              {nicknameMode === 'register' && nicknameSubmitAttempted && !passwordLooksValid && (
                <p className="mb-2 text-[11px] font-semibold text-amber-700">
                  Password must be at least 8 characters.
                </p>
              )}
              <button
                onClick={submitAccount}
                className={cn('w-full py-2 rounded-lg text-xs font-bold transition-all', isDark ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800')}
              >
                {nicknameMode === 'signin' ? 'Sign In' : 'Create Profile'}
              </button>
            </div>
            {googleEnabled ? (
              <div ref={googleSlotRef} className="w-full min-h-10 flex items-center justify-center mt-2" />
            ) : (
              <p className={cn('text-xs mt-2', isDark ? 'text-gray-300' : 'text-gray-500')}>
                Google login is disabled until <code>VITE_GOOGLE_CLIENT_ID</code> is set.
              </p>
            )}
          </>
        )}

        {authError && <p className="text-xs text-red-600 mt-3">{authError}</p>}
      </div>
    </div>
  );
}

function ThemeSettingsCard({
  themeMode,
  resolvedTheme,
  onChange,
}: {
  themeMode: ThemeMode;
  resolvedTheme: 'dark' | 'light';
  onChange: (mode: ThemeMode) => void;
}) {
  const isDark = resolvedTheme === 'dark';
  return (
    <div className={cn('rounded-3xl shadow-xl p-5 border', isDark ? 'bg-[#151a25] border-white/10' : 'bg-white border-black/10')}>
      <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Theme</p>
      <p className={cn('text-sm mb-3', isDark ? 'text-gray-300' : 'text-gray-600')}>
        Current look:
        {' '}
        <span className={cn('font-bold', isDark ? 'text-white' : 'text-black')}>{resolvedTheme === 'dark' ? 'Dark' : 'Light'}</span>
      </p>
      <select
        value={themeMode}
        onChange={(e) => onChange(e.target.value as ThemeMode)}
        className={cn('w-full text-sm font-semibold rounded-xl border px-3 py-3', isDark ? 'bg-white/5 border-white/15 text-white' : 'bg-white border-black/10 text-black')}
        aria-label="Theme mode"
      >
        <option value="dark">Dark</option>
        <option value="light">Light</option>
        <option value="auto">Auto (System)</option>
      </select>
    </div>
  );
}

function CornerAccountNav({
  user,
  resolvedTheme,
  onProfile,
  onLogout,
}: {
  user: CloudUser | null;
  resolvedTheme: 'dark' | 'light';
  onProfile: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-[85]">
      <div
        className={cn(
          'flex items-center gap-3 rounded-full border px-4 py-2 shadow-lg backdrop-blur-md',
          resolvedTheme === 'dark'
            ? 'bg-black/65 border-white/10 text-white'
            : 'bg-white/90 border-black/10 text-black',
        )}
      >
        {user && (
          <>
            <span
              className={cn(
                'max-w-[140px] truncate text-sm font-bold',
                resolvedTheme === 'dark' ? 'text-emerald-300' : 'text-emerald-700',
              )}
              title={user.displayName}
            >
              {user.displayName}
            </span>
            <span className={cn('text-xs', resolvedTheme === 'dark' ? 'text-white/25' : 'text-black/20')}>|</span>
          </>
        )}
        <button
          onClick={onProfile}
          className={cn(
            'text-sm font-bold transition-colors',
            resolvedTheme === 'dark' ? 'text-white hover:text-emerald-300' : 'text-black hover:text-emerald-600',
          )}
        >
          {user ? 'Profile' : 'Sign In / Create Account'}
        </button>
        {user && (
          <>
            <span className={cn('text-xs', resolvedTheme === 'dark' ? 'text-white/25' : 'text-black/20')}>|</span>
            <button
              onClick={onLogout}
              className={cn(
                'text-sm font-bold transition-colors',
                resolvedTheme === 'dark' ? 'text-white hover:text-red-300' : 'text-black hover:text-red-600',
              )}
            >
              Sign Out
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileScreen({
  user,
  authLoading,
  authError,
  syncStateLabel,
  googleEnabled,
  googleSlotRef,
  themeMode,
  resolvedTheme,
  onThemeChange,
  onGuestLogin,
  onNicknameLogin,
  onNicknameRegister,
  onLogout,
  onBack,
  onResendVerification,
  onOpenAdmin,
}: {
  user: CloudUser | null;
  authLoading: boolean;
  authError: string | null;
  syncStateLabel: string;
  googleEnabled: boolean;
  googleSlotRef: React.RefObject<HTMLDivElement | null>;
  themeMode: ThemeMode;
  resolvedTheme: 'dark' | 'light';
  onThemeChange: (mode: ThemeMode) => void;
  onGuestLogin: (nickname?: string) => Promise<boolean>;
  onNicknameLogin: (params: { nickname: string; password: string }) => void;
  onNicknameRegister: (nickname: string, password: string) => void;
  onLogout: () => void;
  onBack: () => void;
  onResendVerification: () => void;
  onOpenAdmin: () => void;
}) {
  const membershipLabel = user?.membershipTier === 'pro' ? 'Pro Member' : 'Basic Member';
  const membershipTone = user?.membershipTier === 'pro'
    ? 'bg-emerald-500 text-black'
    : (resolvedTheme === 'dark' ? 'bg-white text-black' : 'bg-gray-900 text-white');
  const isDark = resolvedTheme === 'dark';

  return (
    <div className={cn('min-h-screen p-6 md:p-10', isDark ? 'bg-[#0b0f17] text-white' : 'bg-[#f5f5f5] text-[#1a1a1a]')}>
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className={cn('p-3 rounded-xl transition-all active:scale-95', isDark ? 'bg-white/10 text-white border border-white/10 hover:bg-white/15' : 'bg-black text-white hover:bg-gray-800')}
              aria-label="Back to menu"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Profile</h1>
              <p className={cn('text-sm', isDark ? 'text-gray-300' : 'text-gray-500')}>Manage account, membership, and theme settings.</p>
            </div>
          </div>
          <div className={cn('px-4 py-2 rounded-full text-xs font-black uppercase tracking-[0.18em]', membershipTone)}>
            {membershipLabel}
          </div>
        </div>

        {user?.provider === 'email' && !user.emailVerifiedAt && (
          <div className={cn('mb-6 rounded-2xl border p-4 text-sm', isDark ? 'border-amber-300/35 bg-amber-500/10 text-amber-200' : 'border-amber-200 bg-amber-50 text-amber-800')}>
            <p className="font-bold mb-1">Email confirmation required</p>
            <p className="mb-3">Please confirm your email address to fully secure your PentaBlocks account.</p>
            <button
              onClick={onResendVerification}
              className={cn('px-4 py-2 rounded-xl font-bold transition-all', isDark ? 'bg-amber-300 text-black hover:bg-amber-200' : 'bg-amber-500 text-white hover:bg-amber-600')}
            >
              Resend confirmation email
            </button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <AccountPanel
            user={user}
            authLoading={authLoading}
            authError={authError}
            syncStateLabel={syncStateLabel}
            googleEnabled={googleEnabled}
            googleSlotRef={googleSlotRef}
            resolvedTheme={resolvedTheme}
            onGuestLogin={onGuestLogin}
            onNicknameLogin={onNicknameLogin}
            onNicknameRegister={onNicknameRegister}
            onLogout={onLogout}
          />

          <div className="flex flex-col gap-6">
            <ThemeSettingsCard
              themeMode={themeMode}
              resolvedTheme={resolvedTheme}
              onChange={onThemeChange}
            />

            <div className={cn('rounded-3xl shadow-xl p-5 border', isDark ? 'bg-[#151a25] border-white/10' : 'bg-white border-black/10')}>
              <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Membership</p>
              <p className={cn('text-lg font-black mb-2', isDark ? 'text-white' : 'text-black')}>{membershipLabel}</p>
              <p className={cn('text-sm mb-2', isDark ? 'text-gray-300' : 'text-gray-600')}>
                Every new account starts as
                {' '}
                <span className={cn('font-bold', isDark ? 'text-white' : 'text-black')}>Basic</span>.
              </p>
              <p className={cn('text-sm', isDark ? 'text-gray-300' : 'text-gray-600')}>
                Pro members see
                {' '}
                <span className={cn('font-bold', isDark ? 'text-white' : 'text-black')}>no ads</span>
                {' '}
                during play. Upgrade flow can be connected next.
              </p>
              {user?.isAdmin && (
                <button
                  onClick={onOpenAdmin}
                  className="mt-4 px-4 py-3 rounded-xl bg-amber-400 text-black text-sm font-bold hover:bg-amber-300 transition-all"
                >
                  Open Admin Panel
                </button>
              )}
            </div>

            <div className={cn('rounded-3xl shadow-xl p-5 border', isDark ? 'bg-[#151a25] border-white/10' : 'bg-white border-black/10')}>
              <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Status</p>
              <div className={cn('space-y-2 text-sm', isDark ? 'text-gray-300' : 'text-gray-600')}>
                <p>
                  Sync:
                  {' '}
                  <span className={cn('font-bold', isDark ? 'text-white' : 'text-black')}>{syncStateLabel}</span>
                </p>
                <p>
                  Provider:
                  {' '}
                  <span className={cn('font-bold', isDark ? 'text-white' : 'text-black')}>{user ? user.provider : 'not signed in'}</span>
                </p>
                <p>
                  Email:
                  {' '}
                  <span className={cn('font-bold', isDark ? 'text-white' : 'text-black')}>
                    {user?.email ?? 'not connected'}
                  </span>
                </p>
                <p>
                  Verification:
                  {' '}
                  <span className={cn('font-bold', isDark ? 'text-white' : 'text-black')}>
                    {user?.provider === 'email'
                      ? (user.emailVerifiedAt ? 'confirmed' : 'pending')
                      : 'not required'}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminScreen({
  user,
  users,
  selectedUserIds,
  loading,
  search,
  providerFilter,
  membershipFilter,
  verificationFilter,
  onSearchChange,
  onProviderFilterChange,
  onMembershipFilterChange,
  onVerificationFilterChange,
  onToggleUserSelection,
  onToggleSelectAll,
  onRefresh,
  onSetMembership,
  onBulkSetMembership,
  onBack,
}: {
  user: CloudUser | null;
  users: AdminCloudUser[];
  selectedUserIds: number[];
  loading: boolean;
  search: string;
  providerFilter: 'all' | 'guest';
  membershipFilter: 'all' | 'pro';
  verificationFilter: 'all' | 'verified';
  onSearchChange: (value: string) => void;
  onProviderFilterChange: (value: 'all' | 'guest') => void;
  onMembershipFilterChange: (value: 'all' | 'pro') => void;
  onVerificationFilterChange: (value: 'all' | 'verified') => void;
  onToggleUserSelection: (userId: number) => void;
  onToggleSelectAll: () => void;
  onRefresh: () => void;
  onSetMembership: (userId: number, membershipTier: 'basic' | 'pro') => void;
  onBulkSetMembership: (membershipTier: 'basic' | 'pro') => void;
  onBack: () => void;
}) {
  const allSelected = users.length > 0 && selectedUserIds.length === users.length;

  return (
    <div className="min-h-screen bg-[#f5f5f5] p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-3 rounded-xl transition-all active:scale-95 bg-black text-white hover:bg-gray-800"
              aria-label="Back to profile"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Admin Panel</h1>
              <p className="text-sm text-gray-500">
                Manual membership management for
                {' '}
                <span className="font-bold text-black">{user?.displayName ?? 'admin'}</span>
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search by name or email"
              className="w-72 max-w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm"
            />
            <button
              onClick={onRefresh}
              className="px-4 py-3 rounded-xl bg-black text-white text-sm font-bold hover:bg-gray-800 transition-all"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
          <select
            value={providerFilter}
            onChange={(e) => onProviderFilterChange(e.target.value as 'all' | 'guest')}
            className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold"
          >
            <option value="all">All providers</option>
            <option value="guest">Guest only</option>
          </select>
          <select
            value={membershipFilter}
            onChange={(e) => onMembershipFilterChange(e.target.value as 'all' | 'pro')}
            className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold"
          >
            <option value="all">All memberships</option>
            <option value="pro">Pro only</option>
          </select>
          <select
            value={verificationFilter}
            onChange={(e) => onVerificationFilterChange(e.target.value as 'all' | 'verified')}
            className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold"
          >
            <option value="all">All verification states</option>
            <option value="verified">Verified only</option>
          </select>
          <button
            onClick={onToggleSelectAll}
            className="rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all"
          >
            {allSelected ? 'Clear Selection' : 'Select Visible'}
          </button>
        </div>

        {selectedUserIds.length > 0 && (
          <div className="mb-6 flex flex-col gap-3 rounded-3xl border border-black/10 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
            <p className="text-sm text-gray-600">
              <span className="font-black text-black">{selectedUserIds.length}</span>
              {' '}
              users selected
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => onBulkSetMembership('basic')}
                disabled={loading}
                className="px-4 py-2 rounded-xl border border-black/10 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                Set Basic
              </button>
              <button
                onClick={() => onBulkSetMembership('pro')}
                disabled={loading}
                className="px-4 py-2 rounded-xl bg-emerald-500 text-black text-sm font-bold hover:bg-emerald-400 disabled:opacity-40"
              >
                Set Pro
              </button>
            </div>
          </div>
        )}

        <div className="bg-white border border-black/10 rounded-3xl shadow-xl overflow-hidden">
          <div className="grid grid-cols-[0.3fr_1.6fr_1fr_0.8fr_0.8fr_0.8fr] gap-4 px-5 py-4 border-b border-black/5 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">
            <span>Select</span>
            <span>User</span>
            <span>Provider</span>
            <span>Membership</span>
            <span>Verified</span>
            <span>Actions</span>
          </div>

          <div className="divide-y divide-black/5">
            {users.map((row) => (
              <div key={row.id} className="grid grid-cols-[0.3fr_1.6fr_1fr_0.8fr_0.8fr_0.8fr] gap-4 px-5 py-4 items-center text-sm">
                <div>
                  <input
                    type="checkbox"
                    checked={selectedUserIds.includes(row.id)}
                    onChange={() => onToggleUserSelection(row.id)}
                    className="h-4 w-4 rounded border-black/20"
                    aria-label={`Select ${row.displayName}`}
                  />
                </div>
                <div>
                  <p className="font-black text-black">{row.displayName}</p>
                  <p className="text-xs text-gray-500">{row.email ?? `User #${row.id}`}</p>
                </div>
                <div className="text-gray-600">{row.provider}</div>
                <div>
                  <span className={cn(
                    'inline-flex px-3 py-1 rounded-full text-xs font-black uppercase tracking-[0.14em]',
                    row.membershipTier === 'pro' ? 'bg-emerald-500 text-black' : 'bg-gray-900 text-white',
                  )}>
                    {row.membershipTier}
                  </span>
                </div>
                <div className="text-gray-600">{row.emailVerifiedAt ? 'Yes' : 'No'}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onSetMembership(row.id, 'basic')}
                    disabled={loading || row.membershipTier === 'basic'}
                    className="px-3 py-2 rounded-xl border border-black/10 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Basic
                  </button>
                  <button
                    onClick={() => onSetMembership(row.id, 'pro')}
                    disabled={loading || row.membershipTier === 'pro'}
                    className="px-3 py-2 rounded-xl bg-emerald-500 text-black text-xs font-bold hover:bg-emerald-400 disabled:opacity-40"
                  >
                    Pro
                  </button>
                </div>
              </div>
            ))}

            {users.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-gray-500">
                No users found for this search.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorModal({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-md z-70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="bg-white p-8 rounded-4xl shadow-2xl max-w-sm w-full text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-base text-gray-700 mb-6">{message}</p>
        <button
          onClick={onClose}
          className="px-8 py-3 bg-black text-white rounded-xl font-bold hover:bg-gray-800 transition-all"
        >
          OK
        </button>
      </motion.div>
    </motion.div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));
  const [viewportHeight, setViewportHeight] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
  const [screen, setScreen] = useState<Screen>('menu');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [completedLevels, setCompletedLevels] = useState<Set<number>>(new Set<number>());

  const [availablePieces, setAvailablePieces] = useState<Piece[]>([]);
  const [placedPieces, setPlacedPieces] = useState<PlacedPiece[]>([]);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(LEVEL_CONFIGS[0].timeSeconds);
  const [isActive, setIsActive] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isWin, setIsWin] = useState(false);
  const [isSolving, setIsSolving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isShowingSolution, setIsShowingSolution] = useState(false);
  const [singlePlayerLevel, setSinglePlayerLevel] = useState(() => readLocalLastLevel());
  const [level, setLevel] = useState(() => readLocalLastLevel());
  const [draggedPiece, setDraggedPiece] = useState<{ id: string; offset: Point } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentState | null>(() => {
    try {
      const saved = localStorage.getItem(CONSENT_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [isFirstSession, setIsFirstSession] = useState(false);
  const [completedThisSession, setCompletedThisSession] = useState(0);
  const [adBreakLevel, setAdBreakLevel] = useState<number | null>(null);
  const [queuedNextLevel, setQueuedNextLevel] = useState<number | null>(null);
  const [isAdBreakVisible, setIsAdBreakVisible] = useState(false);
  const [authUser, setAuthUser] = useState<CloudUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminCloudUser[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminSearch, setAdminSearch] = useState('');
  const [adminProviderFilter, setAdminProviderFilter] = useState<'all' | 'guest'>('all');
  const [adminMembershipFilter, setAdminMembershipFilter] = useState<'all' | 'pro'>('all');
  const [adminVerificationFilter, setAdminVerificationFilter] = useState<'all' | 'verified'>('all');
  const [selectedAdminUserIds, setSelectedAdminUserIds] = useState<number[]>([]);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('single');
  const [activeChallenge, setActiveChallenge] = useState<ActiveChallengeState | null>(null);
  const [activeRoom, setActiveRoom] = useState<ActiveRoomState | null>(null);
  const [activeLeaderboard, setActiveLeaderboard] = useState<ActiveRoomLeaderboardRow[]>([]);
  const [nextRoundReadySubmitted, setNextRoundReadySubmitted] = useState(false);
  const [nextRoundReadyCount, setNextRoundReadyCount] = useState(0);
  const [multiplayerStats, setMultiplayerStats] = useState<MultiplayerStats | null>(null);
  const [multiplayerLockedUntil, setMultiplayerLockedUntil] = useState<number | null>(null);
  // ── Arena state ──
  const [arenaProfile, setArenaProfile] = useState<ArenaProfile | null>(null);
  const [arenaMatch, setArenaMatch] = useState<ArenaMatch | null>(null);
  const [arenaPhase, setArenaPhase] = useState<'idle' | 'queuing' | 'pregame' | 'playing' | 'submitting' | 'result'>('idle');
  const [arenaQueueSeconds, setArenaQueueSeconds] = useState(0);
  const [arenaCountdown, setArenaCountdown] = useState(3);
  const [arenaResultSubmitted, setArenaResultSubmitted] = useState(false);
  const [multiplayerRoundStartMs, setMultiplayerRoundStartMs] = useState<number | null>(null);
  const [multiplayerRoundDeadlineMs, setMultiplayerRoundDeadlineMs] = useState<number | null>(null);
  const [matchSnapshot, setMatchSnapshot] = useState<MultiplayerChallengeSnapshot | null>(null);
  const [hasSubmittedMatchResult, setHasSubmittedMatchResult] = useState(false);
  const [isScoreboardOpen, setIsScoreboardOpen] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const gameSurfaceRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    id: string;
    isFromGrid: boolean;
    target: HTMLElement;
    pointerId: number;
  } | null>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const levelStartRef = useRef<number>(Date.now());
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const cloudSyncTimeoutRef = useRef<number | null>(null);
  const lastCountdownSoundRef = useRef<number | null>(null);
  const lastLowTimeSoundRef = useRef<number | null>(null);
  const lastRoundEndSoundKeyRef = useRef<string | null>(null);
  const stashOrderRef = useRef<string[]>([]);
  const stashScrollRef = useRef<HTMLDivElement>(null);
  const initGameRunIdRef = useRef(0);
  const expectedPuzzlePiecesRef = useRef<Piece[] | null>(null);
  const hasAutoReconciledPuzzleRef = useRef(false);
  const pointerTrackRef = useRef<PointerTrack | null>(null);
  const touchTrackRef = pointerTrackRef;

  const config = LEVEL_CONFIGS[level - 1] ?? LEVEL_CONFIGS[0];
  const boardDimensions = getBoardDimensions(config);
  const gridWidth = boardDimensions.width;
  const gridHeight = boardDimensions.height;
  const baseCellSize = getResponsiveCellSize(viewportWidth);
  // Prevent grid overflow on narrow viewports or very wide grids (e.g. 15×2 arena levels).
  const gridPaddingRaw = baseCellSize < CELL_SIZE ? 20 : GRID_PADDING;
  const maxCellByGrid = Math.max(22, Math.floor((viewportWidth * 0.9 - 2 * gridPaddingRaw) / gridWidth));
  const cellSize = Math.min(baseCellSize, maxCellByGrid);
  const gridPadding = cellSize < CELL_SIZE ? 20 : GRID_PADDING;
  // Stash defaults to board cell size; only shrinks when remaining vertical space genuinely demands it.
  const isMobileView = viewportWidth <= 640;
  const boardHeightPx = gridHeight * cellSize + gridPadding * 2;
  const reservedChromePx = isMobileView ? 280 : 220;
  const availableStashPx = Math.max(80, viewportHeight - boardHeightPx - reservedChromePx);
  const totalStashPieces = availablePieces.length;
  // Game content is capped by max-w-5xl (1024px) with p-4/p-8 outer padding.
  // On desktop (lg: ≥1024px) the sidebar is lg:w-48 (192px) + gap-8 (32px).
  // Below lg the layout stacks so the stash gets the full content width.
  const isDesktopLayout = viewportWidth >= 1024;
  const gameContentWidth = Math.min(viewportWidth - (isMobileView ? 32 : 64), 1024);
  const stashContainerWidth = isDesktopLayout
    ? Math.max(200, gameContentWidth - 224) // 192px sidebar + 32px gap
    : Math.max(200, gameContentWidth);
  const piecesPerRowEstimate = Math.max(2, Math.floor(stashContainerWidth / (cellSize * 4)));
  const estimatedRows = Math.ceil(totalStashPieces / piecesPerRowEstimate);
  const dynamicRowHeight = estimatedRows > 0 ? availableStashPx / estimatedRows : availableStashPx;
  const heightConstrainedCellSize = Math.floor((dynamicRowHeight - 16) / 3);
  const stashCellSize = Math.max(
    isMobileView ? 18 : 22,
    heightConstrainedCellSize > 0 ? Math.min(cellSize, heightConstrainedCellSize) : cellSize
  );
  const targetCells = gridWidth * gridHeight - config.blockedCells.length;
  const totalPiecesCount = config.p4 + config.p3 + config.p2 + config.p1 + config.p5;
  const blockedCellSet = useMemo(() => new Set(config.blockedCells.map(([r, c]) => `${c},${r}`)), [config]);
  const isMultiplayerRound = gameMode === 'multiplayer' && activeChallenge !== null;
  const isArenaRound = gameMode === 'arena' && arenaMatch !== null;
  const isMultiplayerLocked = (isMultiplayerRound || isArenaRound) && multiplayerLockedUntil !== null && nowTs < multiplayerLockedUntil;
  const multiplayerCountdownSeconds = isMultiplayerLocked && multiplayerLockedUntil !== null
    ? Math.max(0, Math.ceil((multiplayerLockedUntil - nowTs) / 1000))
    : 0;
  const resolvedTheme: 'dark' | 'light' = themeMode === 'auto'
    ? (systemPrefersDark ? 'dark' : 'light')
    : themeMode;
  const isProMember = authUser?.membershipTier === 'pro';
  const stashSlotOrder = stashOrderRef.current;

  useEffect(() => {
    const currentIds = Array.from(new Set([
      ...availablePieces.map((piece) => piece.id),
      ...placedPieces.map((piece) => piece.id),
    ]));

    if (placedPieces.length === 0 && availablePieces.length === totalPiecesCount) {
      stashOrderRef.current = availablePieces.map((piece) => piece.id);
      return;
    }

    const nextOrder = stashOrderRef.current.filter((id) => currentIds.includes(id));
    for (const id of currentIds) {
      if (!nextOrder.includes(id)) nextOrder.push(id);
    }
    stashOrderRef.current = nextOrder;
  }, [availablePieces, placedPieces, totalPiecesCount, level]);

  useEffect(() => {
    if (placedPieces.length !== 0) return;
    if (availablePieces.length !== totalPiecesCount) return;
    const stashEl = stashScrollRef.current;
    if (!stashEl) return;
    stashEl.scrollTop = 0;
  }, [availablePieces.length, placedPieces.length, totalPiecesCount, level, gameMode]);

  useEffect(() => {
    if (isGenerating || isShowingSolution || isGameOver || isWin) return;
    if (placedPieces.length > 0) return;

    const expectedPieces = expectedPuzzlePiecesRef.current;
    if (!expectedPieces || expectedPieces.length === 0) return;

    const sameLength = availablePieces.length === expectedPieces.length;
    const currentIds = [...availablePieces.map((piece) => piece.id)].sort().join('|');
    const expectedIds = [...expectedPieces.map((piece) => piece.id)].sort().join('|');
    const isInSync = sameLength && currentIds === expectedIds;
    if (isInSync) {
      hasAutoReconciledPuzzleRef.current = false;
      return;
    }

    if (hasAutoReconciledPuzzleRef.current) return;
    hasAutoReconciledPuzzleRef.current = true;

    setAvailablePieces(clonePieceSet(expectedPieces));
    stashOrderRef.current = expectedPieces.map((piece) => piece.id);
    setSelectedPieceId(null);
    setDraggedPiece(null);
    dragStartRef.current = null;
    isDraggingRef.current = false;
    pointerTrackRef.current = null;
    console.warn('[puzzle-resync] piece set mismatch corrected', {
      level,
      mode: gameMode,
      expected: expectedPieces.map((piece) => piece.id),
      current: availablePieces.map((piece) => piece.id),
    });
  }, [
    availablePieces,
    placedPieces.length,
    isGenerating,
    isShowingSolution,
    isGameOver,
    isWin,
    level,
    gameMode,
  ]);

  // Count only pieces fully inside the grid with no overlap and not on blocked cells
  const seatedPiecesCount = (() => {
    const occupied = new Set<string>(blockedCellSet); // blocked cells are pre-occupied
    let count = 0;
    for (const p of placedPieces) {
      const cells: string[] = [];
      let valid = true;
      for (const cell of p.currentShape) {
        const x = p.position.x + cell.x;
        const y = p.position.y + cell.y;
        if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) { valid = false; break; }
        const key = `${x},${y}`;
        if (occupied.has(key)) { valid = false; break; }
        cells.push(key);
      }
      if (valid) {
        cells.forEach(k => occupied.add(k));
        count++;
      }
    }
    return count;
  })();

  const [bestTimes, setBestTimes] = useState<Record<number, number>>({});
  const [playerStats, setPlayerStats] = useState<PlayerStats>({ ...DEFAULT_PLAYER_STATS });
  const [recentPuzzleFingerprints, setRecentPuzzleFingerprints] = useState<string[]>(
    () => readLocalRecentPuzzleFingerprints(),
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const isMobileViewport = viewportWidth <= 640;
  const isNewSinglePlayerProfile = completedLevels.size === 0
    && Object.keys(bestTimes).length === 0
    && singlePlayerLevel <= 1
    && playerStats.gamesStarted <= 1;

  const showToast = useCallback((message: string, tone: ToastTone = 'neutral') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 2200);
  }, []);

  const updatePlayerStats = useCallback((updater: (prev: PlayerStats) => PlayerStats) => {
    setPlayerStats((prev) => updater(prev));
  }, []);

  const mapRoomToMatchSnapshot = useCallback((data: MultiplayerRoomSnapshot): MultiplayerChallengeSnapshot => {
    const round = data.activeRound;
    const submissions = new Map((round?.submissions ?? []).map((submission) => [submission.userId, submission]));
    const roundWinnerUserId = round?.submissions.find((submission) => submission.placement === 1)?.userId ?? null;
    return {
      challenge: {
        id: data.room.id,
        code: data.room.code,
        levelId: round?.levelId ?? data.room.levelId,
        puzzleSeed: round?.puzzleSeed ?? '',
        isRanked: data.room.isRanked,
        status: data.room.status === 'finished' ? 'closed' : 'open',
        startAt: round?.startAt ?? null,
        winnerUserId: roundWinnerUserId,
        endedAt: round?.endedAt ?? null,
        createdAt: data.room.createdAt,
        updatedAt: data.room.updatedAt,
        closedAt: data.room.closedAt,
        creator: {
          id: data.room.host.id,
          displayName: data.room.host.displayName,
          provider: data.room.host.provider,
        },
      },
      players: data.players.map((player) => {
        const submission = submissions.get(player.userId);
        const status: 'joined' | 'submitted' = submission ? 'submitted' : 'joined';
      const didFinish = submission?.didFinish ?? null;
      return {
          userId: player.userId,
          displayName: player.displayName,
          provider: player.provider,
          joinedAt: player.joinedAt,
          readyAt: null,
        status,
        didWin: submission ? (didFinish ? submission.placement === 1 : false) : null,
        didFinish,
        placement: submission?.placement ?? null,
        elapsedSeconds: submission ? (didFinish ? submission.elapsedSeconds : null) : null,
        remainingSeconds: submission ? (didFinish ? submission.remainingSeconds : null) : null,
        submittedAt: submission ? submission.submittedAt : null,
      };
      }),
    };
  }, []);

  const submitChallengeResult = useCallback(async (didWin: boolean, remainingOverride?: number, didFinish = true) => {
    if (!activeChallenge || hasSubmittedMatchResult) return null;
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - levelStartRef.current) / 1000));
    const remainingSeconds = Math.max(0, Math.floor(remainingOverride ?? timeLeft));
    try {
      let snapshot: MultiplayerChallengeSnapshot;
      if (activeRoom) {
        const roomSnapshot = await submitMultiplayerRoomRound(activeRoom.code, {
          roundNumber: activeRoom.roundNumber,
          elapsedSeconds,
          remainingSeconds,
          didFinish,
        });
        setActiveLeaderboard(
          roomSnapshot.players.map((player) => ({
            userId: player.userId,
            displayName: player.displayName,
            totalPoints: player.totalPoints,
          })),
        );
        if (roomSnapshot.activeRound) {
          setActiveRoom({
            code: roomSnapshot.room.code,
            totalRounds: roomSnapshot.room.totalRounds,
            roundNumber: roomSnapshot.activeRound.roundNumber,
            maxPlayers: roomSnapshot.room.maxPlayers,
            championUserId: roomSnapshot.room.championUserId,
          });
        }
        snapshot = mapRoomToMatchSnapshot(roomSnapshot);
      } else {
        snapshot = await submitMultiplayerChallengeResult(activeChallenge.code, {
          didWin,
          elapsedSeconds,
          remainingSeconds,
        });
      }
      setHasSubmittedMatchResult(true);
      setMatchSnapshot(snapshot);
      setActiveChallenge({
        code: snapshot.challenge.code,
        levelId: snapshot.challenge.levelId,
        puzzleSeed: snapshot.challenge.puzzleSeed,
        isRanked: snapshot.challenge.isRanked,
        startAt: snapshot.challenge.startAt,
        winnerUserId: snapshot.challenge.winnerUserId,
      });
      if (authUser && authUser.provider !== 'guest') {
        const payload = await fetchMultiplayerStats();
        setMultiplayerStats(payload.stats);
      }
      return snapshot;
    } catch (error) {
      setAuthError(authErrorToMessage(error));
      return null;
    }
  }, [activeChallenge, activeRoom, authUser, hasSubmittedMatchResult, mapRoomToMatchSnapshot, timeLeft]);

  // ── Arena callbacks ──────────────────────────────────────────────────────────

  const submitArenaResult = useCallback(async (didFinish: boolean, remainingSecondsOverride?: number) => {
    if (!arenaMatch || arenaResultSubmitted) return;
    setArenaResultSubmitted(true);
    setArenaPhase('submitting');
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - levelStartRef.current) / 1000));
    const remainingSeconds = Math.max(0, Math.floor(remainingSecondsOverride ?? timeLeft));
    try {
      const updated = await submitArenaMatchResult(arenaMatch.code, { didFinish, elapsedSeconds, remainingSeconds });
      setArenaMatch(updated);
      setArenaPhase('result');
      if (authUser) {
        const profile = await fetchArenaProfile();
        setArenaProfile(profile);
      }
    } catch (err) {
      setArenaResultSubmitted(false);
      setArenaPhase('idle');
      showToast('Failed to submit arena result. Please try again.', 'warning');
    }
  }, [arenaMatch, arenaResultSubmitted, authUser, timeLeft, showToast]);

  const handleArenaJoin = useCallback(async () => {
    if (!authUser || authUser.provider === 'guest') {
      showToast('Sign in to play Arena mode.', 'warning');
      return;
    }
    console.log(`[ARENA][client][join] userId=${authUser.id} rating=${authUser.arenaRating} provider=${authUser.provider}`);
    try {
      setArenaPhase('queuing');
      setArenaQueueSeconds(0);
      const status = await joinArenaQueue();
      console.log(`[ARENA][client][join] response:`, status);
      if (status.status === 'matched' && status.matchCode) {
        console.log(`[ARENA][client][join] fetching match code=${status.matchCode}`);
        const match = await fetchArenaMatch(status.matchCode);
        console.log(`[ARENA][client][join] match fetched:`, { id: match?.code, status: match?.status, level: match?.levelId, p1: match?.player1?.displayName, p2: match?.player2?.displayName, startAt: match?.startAt });
        setArenaMatch(match);
        setArenaPhase('pregame');
        setArenaCountdown(3);
      }
    } catch (err) {
      console.error(`[ARENA][client][join] error:`, err);
      setArenaPhase('idle');
      showToast('Failed to join queue.', 'warning');
    }
  }, [authUser, showToast]);

  const handleArenaLeave = useCallback(async () => {
    try { await leaveArenaQueue(); } catch { /* best-effort */ }
    setArenaPhase('idle');
    setArenaQueueSeconds(0);
    setArenaMatch(null);
    setArenaResultSubmitted(false);
  }, []);

  const applyConsent = useCallback((personalizedAds: boolean) => {
    const nextConsent: ConsentState = {
      acceptedAt: new Date().toISOString(),
      personalizedAds,
    };
    setConsent(nextConsent);
    trackEvent('consent_updated', { personalized_ads: personalizedAds });
  }, []);

  const applyMergedProgress = useCallback((payload: {
    completedLevels: number[];
    bestTimes: Record<number, number>;
    playerStats: PlayerStats;
    lastLevel: number;
    recentPuzzleFingerprints?: string[];
  }) => {
    const normalizedLastLevel = Math.min(MAX_LEVEL, Math.max(1, payload.lastLevel));
    const nextCompleted = new Set<number>(payload.completedLevels);
    setCompletedLevels(nextCompleted);
    setBestTimes(payload.bestTimes);
    setPlayerStats(payload.playerStats);
    setRecentPuzzleFingerprints(normalizeRecentPuzzleFingerprints(payload.recentPuzzleFingerprints ?? []));
    setSinglePlayerLevel(normalizedLastLevel);
    if (gameMode !== 'multiplayer' && gameMode !== 'arena') {
      setLevel(normalizedLastLevel);
    }
  }, [gameMode]);

  const clearLegacyLocalProgress = useCallback(() => {
    localStorage.removeItem(LOCAL_COMPLETED_KEY);
    localStorage.removeItem(LOCAL_BEST_TIMES_KEY);
    localStorage.removeItem(LOCAL_PLAYER_STATS_KEY);
    localStorage.removeItem(LOCAL_LAST_LEVEL_KEY);
    localStorage.removeItem(RECENT_PUZZLE_HISTORY_KEY);
  }, []);

  const resetProgressToDefaults = useCallback(() => {
    setCompletedLevels(new Set<number>());
    setBestTimes({});
    setPlayerStats({ ...DEFAULT_PLAYER_STATS });
    setSinglePlayerLevel(1);
    setLevel(1);
  }, []);

  const hydrateCloudForUser = useCallback(async () => {
    const cloudPayload = await fetchCloudProgress();
    const isolated = {
      completedLevels: cloudPayload.completedLevels,
      bestTimes: cloudPayload.bestTimes,
      playerStats: cloudPayload.playerStats,
      lastLevel: cloudPayload.lastLevel,
      recentPuzzleFingerprints: cloudPayload.recentPuzzleFingerprints,
    };
    // Account progress must be isolated per user. Do not auto-merge local device data.
    applyMergedProgress(isolated);
    setCloudReady(true);
  }, [applyMergedProgress]);

  const handleGuestLogin = useCallback(async (nickname?: string) => {
    try {
      setAuthError(null);
      setAuthLoading(true);
      const user = await signInGuest(nickname);
      setAuthUser(user);
      await hydrateCloudForUser();
      showToast('Cloud guest profile connected.', 'success');
      trackEvent('auth_login', { provider: 'guest' });
      return true;
    } catch (error) {
      setAuthError(authErrorToMessage(error));
      return false;
    } finally {
      setAuthLoading(false);
    }
  }, [hydrateCloudForUser, showToast]);

  const handleGuestNicknameUpdate = useCallback(async (nickname: string) => {
    const updated = await updateGuestNickname(nickname);
    setAuthUser(updated);
  }, []);

  const handleGoogleCredential = useCallback(async (idToken: string) => {
    try {
      setAuthError(null);
      setAuthLoading(true);
      const user = await signInGoogle(idToken);
      setAuthUser(user);
      await hydrateCloudForUser();
      showToast('Google profile connected.', 'success');
      trackEvent('auth_login', { provider: 'google' });
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }, [hydrateCloudForUser, showToast]);

  const handleNicknameRegister = useCallback(async (nickname: string, password: string) => {
    try {
      setAuthError(null);
      setAuthLoading(true);
      const user = await signUpNickname({ nickname, password });
      setAuthUser(user);
      await hydrateCloudForUser();
      showToast('Profile created with nickname.', 'success');
      trackEvent('auth_login', { provider: 'nickname_register' });
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }, [hydrateCloudForUser, showToast]);

  const handleNicknameLogin = useCallback(async (params: { nickname: string; password: string }) => {
    try {
      setAuthError(null);
      setAuthLoading(true);
      const user = await signInNickname(params);
      setAuthUser(user);
      await hydrateCloudForUser();
      showToast('Nickname profile connected.', 'success');
      trackEvent('auth_login', { provider: 'nickname' });
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }, [hydrateCloudForUser, showToast]);

  const handleLogout = useCallback(async () => {
    try {
      await signOutCloud();
      setAuthUser(null);
      setCloudReady(false);
      setAuthError(null);
      setMultiplayerStats(null);
      setActiveChallenge(null);
      setActiveRoom(null);
      setActiveLeaderboard([]);
      setNextRoundReadySubmitted(false);
      setNextRoundReadyCount(0);
      setGameMode('single');
      setMatchSnapshot(null);
      setHasSubmittedMatchResult(false);
      setMultiplayerLockedUntil(null);
      setRecentPuzzleFingerprints([]);
      resetProgressToDefaults();
      clearLegacyLocalProgress();
      showToast('Signed out. Progress reset to Level 1 on this device.', 'neutral');
      trackEvent('auth_logout');
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    }
  }, [clearLegacyLocalProgress, resetProgressToDefaults, showToast]);

  const handleResendVerification = useCallback(async () => {
    try {
      setAuthError(null);
      await resendEmailVerification();
      showToast('Confirmation email sent.', 'success');
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    }
  }, [showToast]);

  const loadAdminUsers = useCallback(async (search = '') => {
    try {
      setAdminLoading(true);
      const payload = await fetchAdminUsers(search);
      setAdminUsers(payload.users);
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    } finally {
      setAdminLoading(false);
    }
  }, []);

  const handleAdminMembershipChange = useCallback(async (userId: number, membershipTier: 'basic' | 'pro') => {
    try {
      setAdminLoading(true);
      const payload = await updateAdminMembership(userId, membershipTier);
      setAdminUsers((prev) => prev.map((entry) => (entry.id === userId ? payload.user : entry)));
      if (authUser?.id === userId) {
        setAuthUser(payload.user);
      }
      showToast(`Membership updated to ${membershipTier}.`, 'success');
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    } finally {
      setAdminLoading(false);
    }
  }, [authUser?.id, showToast]);

  const handleToggleAdminUserSelection = useCallback((userId: number) => {
    setSelectedAdminUserIds((prev) => (
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    ));
  }, []);

  const filteredAdminUsers = useMemo(() => adminUsers.filter((entry) => {
    if (adminProviderFilter === 'guest' && entry.provider !== 'guest') return false;
    if (adminMembershipFilter === 'pro' && entry.membershipTier !== 'pro') return false;
    if (adminVerificationFilter === 'verified' && !entry.emailVerifiedAt) return false;
    return true;
  }), [adminUsers, adminProviderFilter, adminMembershipFilter, adminVerificationFilter]);

  const handleToggleSelectAllAdminUsers = useCallback(() => {
    setSelectedAdminUserIds((prev) => {
      const visibleIds = filteredAdminUsers.map((entry) => entry.id);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.includes(id));
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleIds.includes(id));
      }
      return Array.from(new Set([...prev, ...visibleIds]));
    });
  }, [filteredAdminUsers]);

  const handleBulkAdminMembershipChange = useCallback(async (membershipTier: 'basic' | 'pro') => {
    if (selectedAdminUserIds.length === 0) return;
    try {
      setAdminLoading(true);
      const payload = await bulkUpdateAdminMembership(selectedAdminUserIds, membershipTier);
      const updatedMap = new Map(payload.users.map((entry) => [entry.id, entry] as const));
      setAdminUsers((prev) => prev.map((entry) => updatedMap.get(entry.id) ?? entry));
      if (authUser && updatedMap.has(authUser.id)) {
        setAuthUser(updatedMap.get(authUser.id) ?? authUser);
      }
      showToast(`${payload.users.length} users updated to ${membershipTier}.`, 'success');
      setSelectedAdminUserIds([]);
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    } finally {
      setAdminLoading(false);
    }
  }, [authUser, selectedAdminUserIds, showToast]);

  useEffect(() => {
    const rawCount = Number(localStorage.getItem(SESSION_COUNT_KEY) ?? '0');
    const safeCount = Number.isFinite(rawCount) && rawCount >= 0 ? rawCount : 0;
    const nextCount = safeCount + 1;
    localStorage.setItem(SESSION_COUNT_KEY, String(nextCount));
    setIsFirstSession(safeCount === 0);
    trackEvent('session_start', { session_number: nextCount, first_session: safeCount === 0 });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_MODE_KEY, themeMode);
    } catch {
      // no-op
    }
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [themeMode, resolvedTheme]);

  useEffect(() => {
    try {
      localStorage.setItem(RECENT_PUZZLE_HISTORY_KEY, JSON.stringify(recentPuzzleFingerprints));
    } catch {
      // no-op
    }
  }, [recentPuzzleFingerprints]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomCode = params.get('room');
    const challengeCode = params.get('challenge');
    if (!roomCode && !challengeCode) return;
    setScreen('multiplayer');
  }, []);

  useEffect(() => {
    let active = true;
    setAuthLoading(true);
    const safetyTimeout = window.setTimeout(() => {
      if (!active) return;
      setAuthLoading(false);
      setAuthError((prev) => prev ?? authErrorToMessage(new Error('auth_bootstrap_timeout')));
    }, 10000);

    const bootstrapAuth = async () => {
      try {
        const user = await fetchCurrentUser();
        if (!active) return;
        if (user) {
          setAuthUser(user);
          await hydrateCloudForUser();
        } else {
          resetProgressToDefaults();
          clearLegacyLocalProgress();
        }
      } catch (error) {
        if (!active) return;
        setAuthError(authErrorToMessage(error));
      } finally {
        window.clearTimeout(safetyTimeout);
        if (active) setAuthLoading(false);
      }
    };

    void bootstrapAuth();

    return () => {
      active = false;
      window.clearTimeout(safetyTimeout);
    };
  }, [clearLegacyLocalProgress, hydrateCloudForUser, resetProgressToDefaults]);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setGoogleEnabled(false);
      return;
    }
    setGoogleEnabled(true);
    if (authUser || !googleButtonRef.current) return;

    let active = true;
    void mountGoogleLoginButton(googleButtonRef.current, clientId, (token) => {
      if (!active) return;
      void handleGoogleCredential(token);
    }).catch((error) => {
      if (!active) return;
      setAuthError(authErrorToMessage(error));
    });

    return () => {
      active = false;
    };
  }, [authUser, handleGoogleCredential, googleEnabled, screen]);

  useEffect(() => {
    trackEvent('screen_view', { screen });
  }, [screen]);

  useEffect(() => {
    if (screen !== 'admin' || !authUser?.isAdmin) return;
    void loadAdminUsers(adminSearch);
  }, [screen, authUser?.isAdmin, adminSearch, loadAdminUsers]);

  useEffect(() => {
    setSelectedAdminUserIds((prev) => prev.filter((id) => filteredAdminUsers.some((entry) => entry.id === id)));
  }, [filteredAdminUsers]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!authUser || authUser.provider === 'guest') {
        setMultiplayerStats(null);
        return;
      }
      try {
        const payload = await fetchMultiplayerStats();
        if (!active) return;
        setMultiplayerStats(payload.stats);
      } catch {
        if (!active) return;
        setMultiplayerStats(null);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [authUser]);

  // Load arena profile when arena screen is opened
  useEffect(() => {
    if (screen !== 'arena' || !authUser || authUser.provider === 'guest') return;
    let active = true;
    fetchArenaProfile()
      .then((p) => { if (active) setArenaProfile(p); })
      .catch(() => { /* silent — show defaults */ });
    return () => { active = false; };
  }, [screen, authUser]);

  useEffect(() => {
    if (!consent) return;
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    if (isProMember) return;
    configureAdSensePreference(consent.personalizedAds);
    if (initializeAdSense(consent.personalizedAds)) {
      trackEvent('adsense_initialized', {
        personalized_ads: consent.personalizedAds,
      });
    }
  }, [consent, isProMember]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verifyEmail');
    if (!token) return;

    let active = true;
    const verify = async () => {
      try {
        const payload = await verifyEmailConfirmation(token);
        if (!active) return;
        if (payload.user) {
          setAuthUser(payload.user);
        }
        showToast(payload.alreadyVerified ? 'Email already confirmed.' : 'Email confirmed successfully.', 'success');
        setScreen('profile');
      } catch (error) {
        if (!active) return;
        setAuthError(authErrorToMessage(error));
        setScreen('profile');
      } finally {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('verifyEmail');
        window.history.replaceState({}, '', nextUrl.toString());
      }
    };

    void verify();
    return () => {
      active = false;
    };
  }, [showToast]);

  useEffect(() => {
    if (!authUser || !cloudReady || gameMode !== 'single') return;

    if (cloudSyncTimeoutRef.current) {
      window.clearTimeout(cloudSyncTimeoutRef.current);
    }

    cloudSyncTimeoutRef.current = window.setTimeout(() => {
      setCloudSyncing(true);
      void saveCloudProgress({
        completedLevels: [...completedLevels],
        bestTimes,
        playerStats,
        lastLevel: singlePlayerLevel,
        recentPuzzleFingerprints,
      })
        .catch((error) => {
          setAuthError(authErrorToMessage(error));
        })
        .finally(() => {
          setCloudSyncing(false);
        });
    }, 900);

    return () => {
      if (cloudSyncTimeoutRef.current) {
        window.clearTimeout(cloudSyncTimeoutRef.current);
      }
    };
  }, [authUser, cloudReady, completedLevels, bestTimes, playerStats, singlePlayerLevel, recentPuzzleFingerprints, gameMode]);

  async function launchMultiplayerRoundFromSnapshot(snapshot: MultiplayerRoomSnapshot) {
    const round = snapshot.activeRound;
    if (!round) return;
    setActiveLeaderboard(
      snapshot.players.map((player) => ({
        userId: player.userId,
        displayName: player.displayName,
        totalPoints: player.totalPoints,
      })),
    );
    setActiveRoom({
      code: snapshot.room.code,
      totalRounds: snapshot.room.totalRounds,
      roundNumber: round.roundNumber,
      maxPlayers: snapshot.room.maxPlayers,
      championUserId: snapshot.room.championUserId,
    });
    setActiveChallenge({
      code: snapshot.room.code,
      levelId: round.levelId,
      puzzleSeed: round.puzzleSeed,
      isRanked: snapshot.room.isRanked,
      startAt: round.startAt,
      winnerUserId: null,
    });
    setMatchSnapshot(null);
    setHasSubmittedMatchResult(false);
    setNextRoundReadySubmitted(false);
    setNextRoundReadyCount(0);
    await initGame(round.levelId, 'start', {
      mode: 'multiplayer',
      puzzleSeed: round.puzzleSeed,
      startAt: round.startAt,
      deadlineAt: round.deadlineAt,
      timeoutSeconds: round.timeoutSeconds,
    });
    setScreen('game');
    const msLeft = Date.parse(round.startAt) - Date.now();
    if (msLeft > 0) {
      showToast(`Round ${round.roundNumber}/${snapshot.room.totalRounds} starts in ${Math.ceil(msLeft / 1000)}s`, 'neutral');
    } else {
      showToast(`Round ${round.roundNumber}/${snapshot.room.totalRounds} started.`, 'neutral');
    }
  }

  useEffect(() => {
    if (!isMultiplayerRound || !activeChallenge || !authUser) return;
    let active = true;
    const poll = async () => {
      try {
        if (activeRoom) {
          const latestRoom = await fetchMultiplayerRoom(activeRoom.code);
          if (!active) return;
          const mapped = mapRoomToMatchSnapshot(latestRoom);
          setMatchSnapshot(mapped);
          setActiveLeaderboard(
            latestRoom.players.map((player) => ({
              userId: player.userId,
              displayName: player.displayName,
              totalPoints: player.totalPoints,
            })),
          );
          if (nextRoundReadySubmitted) {
            const targetRound = activeRoom.roundNumber + 1;
            const readyCount = latestRoom.players.filter((player) => player.readyForRound >= targetRound).length;
            setNextRoundReadyCount(readyCount);
          }
          const round = latestRoom.activeRound;
          const hasAdvancedRound = Boolean(
            round
            && (
              round.roundNumber !== activeRoom.roundNumber
              || round.puzzleSeed !== activeChallenge.puzzleSeed
            ),
          );
          if (hasAdvancedRound) {
            await launchMultiplayerRoundFromSnapshot(latestRoom);
            return;
          }
          if (round) {
            const roundWinner = round.submissions.find((submission) => submission.placement === 1)?.userId ?? null;
            setActiveChallenge({
              code: latestRoom.room.code,
              levelId: round.levelId,
              puzzleSeed: round.puzzleSeed,
              isRanked: latestRoom.room.isRanked,
              startAt: round.startAt,
              winnerUserId: roundWinner,
            });
            setActiveRoom({
              code: latestRoom.room.code,
              totalRounds: latestRoom.room.totalRounds,
              roundNumber: round.roundNumber,
              maxPlayers: latestRoom.room.maxPlayers,
              championUserId: latestRoom.room.championUserId,
            });
          }
          const mySubmission = round?.submissions.find((submission) => submission.userId === authUser.id) ?? null;
          if (mySubmission && !hasSubmittedMatchResult) {
            setHasSubmittedMatchResult(true);
          }
          if (mySubmission && !mySubmission.didFinish && !isWin && !isGameOver) {
            setIsActive(false);
            setIsGameOver(true);
            showToast('Round ended. You were the last unresolved player.', 'warning');
          }
        } else {
          const latest = await fetchMultiplayerChallenge(activeChallenge.code);
          if (!active) return;
          const normalized: ActiveChallengeState = {
            code: latest.challenge.code,
            levelId: latest.challenge.levelId,
            puzzleSeed: latest.challenge.puzzleSeed,
            isRanked: latest.challenge.isRanked,
            startAt: latest.challenge.startAt,
            winnerUserId: latest.challenge.winnerUserId,
          };
          setActiveChallenge(normalized);
          setMatchSnapshot({ challenge: latest.challenge, players: latest.players });

        }
      } catch {
        // Polling errors should not disrupt local play loop.
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [isMultiplayerRound, activeChallenge, activeRoom, authUser, hasSubmittedMatchResult, isGameOver, isWin, mapRoomToMatchSnapshot, nextRoundReadySubmitted, showToast, submitChallengeResult]);


  // Arena: poll match until finished/aborted (continues after submit to catch opponent result / timeout finalization)
  useEffect(() => {
    if (gameMode !== 'arena' || !arenaMatch) return;
    if (arenaMatch.status === 'finished' || arenaMatch.status === 'aborted') return;
    let active = true;
    const interval = window.setInterval(async () => {
      try {
        const updated = await fetchArenaMatch(arenaMatch.code);
        if (!active) return;
        setArenaMatch(updated);
      } catch { /* ignore */ }
    }, 3000);
    return () => { active = false; window.clearInterval(interval); };
  }, [gameMode, arenaMatch]);

  // Load arena profile when entering arena screen
  useEffect(() => {
    if (screen !== 'arena' || !authUser || authUser.provider === 'guest') return;
    fetchArenaProfile().then(setArenaProfile).catch(() => undefined);
  }, [screen, authUser]);

  const markLevelComplete = useCallback((lvl: number) => {
    setCompletedLevels(prev => {
      return new Set([...prev, lvl]);
    });
  }, []);

  const saveBestTime = useCallback((lvl: number, remaining: number) => {
    setBestTimes(prev => {
      if (prev[lvl] !== undefined && prev[lvl] >= remaining) return prev;
      return { ...prev, [lvl]: remaining };
    });
  }, []);

  // Returns: true = valid on grid, false = invalid on grid, null = fully outside grid
  const isDragValid = useCallback((): boolean | null => {
    if (!draggedPiece) return true;
    const piece = placedPieces.find((p) => p.id === draggedPiece.id);
    if (!piece) return true;

    // Check if piece is entirely outside the grid — no highlight needed
    const allOutside = piece.currentShape.every((cell) => {
      const x = piece.position.x + cell.x;
      const y = piece.position.y + cell.y;
      return x < 0 || x >= gridWidth || y < 0 || y >= gridHeight;
    });
    if (allOutside) return null;

    const tempOccupied = new Set<string>(blockedCellSet);
    for (const p of placedPieces) {
      if (p.id === draggedPiece.id) continue;
      for (const cell of p.currentShape) {
        tempOccupied.add(`${p.position.x + cell.x},${p.position.y + cell.y}`);
      }
    }

    for (const cell of piece.currentShape) {
      const x = piece.position.x + cell.x;
      const y = piece.position.y + cell.y;
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return false;
      if (tempOccupied.has(`${x},${y}`)) return false;
    }
    return true;
  }, [draggedPiece, placedPieces, gridWidth, gridHeight, blockedCellSet]);

  const initGame = useCallback(async (
    targetLevel?: number,
    reason: 'start' | 'restart' | 'next' = 'start',
    options?: {
      mode?: GameMode;
      puzzleSeed?: string;
      startAt?: string | null;
      deadlineAt?: string | null;
      timeoutSeconds?: number | null;
    },
  ) => {
    const runId = initGameRunIdRef.current + 1;
    initGameRunIdRef.current = runId;
    const isStaleRun = () => initGameRunIdRef.current !== runId;

    const mode: GameMode = options?.mode ?? 'single';
    const levelToSet = typeof targetLevel === 'number' ? targetLevel : level;
    if (typeof targetLevel === 'number') {
      setLevel(targetLevel);
      if (mode === 'single') {
        setSinglePlayerLevel(targetLevel);
      }
    }
    const cfg = LEVEL_CONFIGS[levelToSet - 1];

    setGameMode(mode);
    setHasSubmittedMatchResult(false);
    setMatchSnapshot(null);
    setIsScoreboardOpen(false);
    if (mode === 'single') {
      updatePlayerStats((prev) => ({
        ...prev,
        gamesStarted: prev.gamesStarted + 1,
        restarts: prev.restarts + (reason === 'restart' ? 1 : 0),
      }));
    }

    setIsGenerating(true);
    setIsActive(false);
    setIsGameOver(false);
    setIsWin(false);
    setIsShowingSolution(false);
    setPlacedPieces([]);
    setAvailablePieces([]);
    setDraggedPiece(null);
    setSelectedPieceId(null);
    stashOrderRef.current = [];
    expectedPuzzlePiecesRef.current = null;
    hasAutoReconciledPuzzleRef.current = false;
    dragStartRef.current = null;
    isDraggingRef.current = false;
    const activeTrack = pointerTrackRef.current;
    if (activeTrack?.longPressTimer) {
      window.clearTimeout(activeTrack.longPressTimer);
    }
    pointerTrackRef.current = null;
    const startAtMsRaw = options?.startAt ? Date.parse(options.startAt) : NaN;
    const deadlineAtMsRaw = options?.deadlineAt ? Date.parse(options.deadlineAt) : NaN;
    const hasStartAt = Number.isFinite(startAtMsRaw);
    const hasDeadlineAt = Number.isFinite(deadlineAtMsRaw);
    const timeoutSeconds = Math.max(1, Number(options?.timeoutSeconds ?? cfg.timeSeconds));
    const inferredStartMs = hasDeadlineAt ? (deadlineAtMsRaw - timeoutSeconds * 1000) : Date.now();
    const effectiveStartMs = hasStartAt ? startAtMsRaw : inferredStartMs;
    const elapsedFromStart = Math.max(0, Math.floor((Date.now() - effectiveStartMs) / 1000));
    const initialTimeLeft = (mode === 'multiplayer' || mode === 'arena')
      ? (hasDeadlineAt
        ? Math.max(0, Math.floor((deadlineAtMsRaw - Date.now()) / 1000))
        : Math.max(0, timeoutSeconds - elapsedFromStart))
      : cfg.timeSeconds;
    setTimeLeft(initialTimeLeft);
    levelStartRef.current = effectiveStartMs;
    if (mode === 'single' && reason !== 'next') {
      setAdBreakLevel(null);
      setQueuedNextLevel(null);
      setIsAdBreakVisible(false);
    }
    if (mode === 'multiplayer' || mode === 'arena') {
      setMultiplayerRoundStartMs(effectiveStartMs);
      setMultiplayerRoundDeadlineMs(hasDeadlineAt ? deadlineAtMsRaw : null);
      setNowTs(Date.now());
      if (hasStartAt) {
        setMultiplayerLockedUntil(startAtMsRaw);
        if (startAtMsRaw <= Date.now()) {
          setIsActive(initialTimeLeft > 0);
        }
      } else {
        setMultiplayerLockedUntil(null);
        setIsActive(initialTimeLeft > 0);
      }
    } else {
      setMultiplayerLockedUntil(null);
      setMultiplayerRoundStartMs(null);
      setMultiplayerRoundDeadlineMs(null);
    }

    trackEvent('level_start', {
      level: levelToSet,
      reason,
      board: `${getBoardDimensions(cfg).width}x${getBoardDimensions(cfg).height}`,
      time_limit: cfg.timeSeconds,
      mode,
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    if (isStaleRun()) return;

    let selectedPuzzle: PuzzleSelectionResult | null = null;
    let generationAttempt = 0;

    const logGenerationFailure = (
      attemptLabel: string,
      failedLevelId: number,
      error: unknown,
      fallbackLevelId?: number,
    ) => {
      const generationTelemetry = (error as { generationTelemetry?: PuzzleGenerationTelemetry })?.generationTelemetry;
      console.warn('puzzle generation failed', {
        attempt: attemptLabel,
        levelId: failedLevelId,
        poolSize: getPrecomputedLevelPool(LEVEL_CONFIGS[failedLevelId - 1]).length,
        recentHistorySize: recentPuzzleFingerprints.length,
        attemptsUsed: generationTelemetry?.attemptsUsed ?? null,
        solvedCandidates: generationTelemetry?.solvedCandidates ?? null,
        source: generationTelemetry?.source ?? null,
        fallbackLevelId: fallbackLevelId ?? null,
        reason: error instanceof Error ? error.message : String(error),
      });
    };

    try {
      generationAttempt += 1;
      if ((mode === 'multiplayer' || mode === 'arena') && options?.puzzleSeed) {
        // Multiplayer rooms/challenges: shared seed keeps all players on the same puzzle.
        selectedPuzzle = generateChallengePieces(options.puzzleSeed, cfg);
      } else {
        // Arena and single-player both use the same pool-based mechanism.
        // Arena passes [] history so any good pool entry is eligible (no cross-session bias).
        const history = mode === 'arena' ? [] : recentPuzzleFingerprints;
        selectedPuzzle = selectSinglePlayerPuzzle(cfg, history);
      }
      if (isStaleRun()) return;
      if (!isGeneratedPuzzleStructurallyValid(cfg, selectedPuzzle.entry.pieces)) {
        throw new Error('generated puzzle payload invalid');
      }
    } catch (error) {
      if (isStaleRun()) return;
      logGenerationFailure(`primary-${generationAttempt}`, levelToSet, error);

      // Retry with relaxed constraints
      try {
        generationAttempt += 1;
        if ((mode === 'multiplayer' || mode === 'arena') && options?.puzzleSeed) {
          selectedPuzzle = generateChallengePieces(options.puzzleSeed, cfg, {
            attemptsPerBatch: 320,
            batchCount: 18,
          });
        } else {
          const history = mode === 'arena' ? [] : recentPuzzleFingerprints;
          selectedPuzzle = selectSinglePlayerPuzzle(cfg, history, {
            attemptsPerBatch: 620,
            batchCount: 6,
            noveltyPenalty: 0,
            allowRecentFallback: true,
          });
        }
        if (isStaleRun()) return;
        if (!isGeneratedPuzzleStructurallyValid(cfg, selectedPuzzle.entry.pieces)) {
          throw new Error('generated puzzle payload invalid');
        }
      } catch (finalError) {
        if (isStaleRun()) return;
        // This means the level config itself has no solvable combination at all.
        // Should never happen with validated configs.
        logGenerationFailure(`final-${generationAttempt}`, levelToSet, finalError);
        console.error(`Level ${levelToSet} config is unsolvable — this is a bug.`);
        setIsGenerating(false);
        setIsActive(false);
        setErrorMessage('We could not generate a valid puzzle for this level. Please try again.');
        return;
      }
    }
    if (isStaleRun()) return;

    const nextAvailablePieces = orientPiecesForStash(selectedPuzzle.entry.pieces);
    expectedPuzzlePiecesRef.current = clonePieceSet(nextAvailablePieces);
    hasAutoReconciledPuzzleRef.current = false;
    if (mode === 'arena') {
      const cfg2 = LEVEL_CONFIGS[levelToSet - 1];
      const bw = getBoardDimensions(cfg2).width;
      const bh = getBoardDimensions(cfg2).height;
      const vw = viewportWidth;
      const vh = viewportHeight;
      const isMob = vw <= 640;
      const isDesk = vw >= 1024;
      const cs = Math.min(isMob ? (vw<=390?34:vw<=480?36:40) : 45, Math.max(22, Math.floor((vw * 0.9 - 2*(isMob?20:32)) / bw)));
      const boardH = bh * cs + (cs < 45 ? 20 : 32) * 2;
      const availSt = Math.max(80, vh - boardH - (isMob ? 280 : 220));
      const gcw = Math.min(vw - (isMob ? 32 : 64), 1024);
      const scw = isDesk ? Math.max(200, gcw - 224) : Math.max(200, gcw);
      const ppr = Math.max(2, Math.floor(scw / (cs * 4)));
      const eRows = Math.ceil(nextAvailablePieces.length / ppr);
      const drh = eRows > 0 ? availSt / eRows : availSt;
      const hcs = Math.floor((drh - 16) / 3);
      const scs = Math.max(isMob ? 18 : 22, hcs > 0 ? Math.min(cs, hcs) : cs);
      console.log(`[ARENA][client][initGame] level=${levelToSet} grid=${bw}x${bh} vp=${vw}x${vh} cellSize=${cs} boardH=${boardH} availableStashPx=${availSt} stashContainerWidth=${scw} piecesPerRow=${ppr} estimatedRows=${eRows} stashCellSize=${scs} numPieces=${nextAvailablePieces.length} pieces=${nextAvailablePieces.map(p=>p.id).join(',')}`);
    }
    setAvailablePieces(nextAvailablePieces);
    if (mode === 'single') {
      setRecentPuzzleFingerprints((prev) => appendRecentPuzzleFingerprint(prev, selectedPuzzle.entry.fingerprint));
    }
    setIsGenerating(false);
  }, [level, updatePlayerStats, recentPuzzleFingerprints]);

  const startArenaGame = useCallback(
    async (match: ArenaMatch) => {
      console.log(`[ARENA][client][startGame] code=${match.code} level=${match.levelId} p1=${match.player1.displayName}(${match.player1.id}) p2=${match.player2.displayName}(${match.player2.id}) startAt=${match.startAt} timeout=${match.timeoutSeconds}s seed=${match.puzzleSeed}`);
      if (match.player1.id === match.player2.id) {
        console.error(`[ARENA][client][startGame] SELF-MATCH detected! p1===p2=${match.player1.id}`);
        setArenaMatch(null);
        setArenaPhase('idle');
        setScreen('arena');
        showToast('Invalid arena match detected. Please queue again.', 'warning');
        return;
      }
      // Prevent pregame effect from re-triggering start on every arenaMatch poll update.
      setArenaPhase('playing');
      setScreen("game");
      const startAtMs = match.startAt ? Date.parse(match.startAt) : Date.now();
      const deadlineAt = new Date(startAtMs + match.timeoutSeconds * 1000).toISOString();
      console.log(`[ARENA][client][startGame] calling initGame level=${match.levelId} seed=${match.puzzleSeed} deadlineAt=${deadlineAt}`);
      await initGame(match.levelId, "start", {
        mode: "arena",
        puzzleSeed: match.puzzleSeed,
        startAt: match.startAt ?? undefined,
        deadlineAt,
        timeoutSeconds: match.timeoutSeconds,
      });
    },
    [initGame, showToast],
  );

  // Queue polling
  useEffect(() => {
    if (arenaPhase !== "queuing") return;
    console.log(`[ARENA][client][poll] starting polling interval`);
    let cancelled = false;
    const interval = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const status = await pollArenaQueueStatus();
        if (cancelled) return;
        console.log(`[ARENA][client][poll] status:`, status);
        if (status.status === "waiting") {
          setArenaQueueSeconds(status.waitSeconds);
        } else if (status.status === "matched" && status.matchCode) {
          console.log(`[ARENA][client][poll] matched! fetching match code=${status.matchCode}`);
          const match = await fetchArenaMatch(status.matchCode);
          if (cancelled) return;
          console.log(`[ARENA][client][poll] match fetched:`, { code: match?.code, level: match?.levelId, p1: match?.player1?.displayName, p2: match?.player2?.displayName, startAt: match?.startAt });
          setArenaMatch(match);
          setArenaPhase("pregame");
          setArenaCountdown(3);
        }
      } catch (err) {
        console.error(`[ARENA][client][poll] error:`, err);
        setArenaQueueSeconds((s) => s + 2); // fallback on network error
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      console.log(`[ARENA][client][poll] polling stopped`);
    };
  }, [arenaPhase]);

  // Pregame countdown then launch
  useEffect(() => {
    if (arenaPhase !== "pregame" || !arenaMatch) return;
    const startAtMs = arenaMatch.startAt
      ? Date.parse(arenaMatch.startAt)
      : Date.now() + 3000;
    const msLeft = startAtMs - Date.now();
    console.log(`[ARENA][client][pregame] countdown msLeft=${msLeft} startAt=${arenaMatch.startAt} code=${arenaMatch.code}`);
    if (msLeft <= 0) {
      console.log(`[ARENA][client][pregame] msLeft<=0, launching immediately`);
      void startArenaGame(arenaMatch);
      return;
    }
    const iv = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((startAtMs - Date.now()) / 1000));
      setArenaCountdown(remaining);
      if (remaining <= 0) {
        window.clearInterval(iv);
        console.log(`[ARENA][client][pregame] countdown done, launching game`);
        void startArenaGame(arenaMatch);
      }
    }, 250);
    return () => window.clearInterval(iv);
  }, [arenaPhase, arenaMatch, startArenaGame]);

  useEffect(() => {
    if ((!isMultiplayerRound && !isArenaRound) || multiplayerLockedUntil === null) return;
    const msLeft = multiplayerLockedUntil - Date.now();
    if (msLeft <= 0) {
      setMultiplayerLockedUntil(null);
      setIsActive(timeLeft > 0);
      return;
    }

    const timer = window.setTimeout(() => {
      setMultiplayerLockedUntil(null);
      setIsActive(timeLeft > 0);
    }, msLeft);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isMultiplayerRound, isArenaRound, multiplayerLockedUntil, timeLeft]);

  useEffect(() => {
    if (!isMultiplayerLocked) return;
    const interval = window.setInterval(() => {
      setNowTs(Date.now());
    }, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, [isMultiplayerLocked]);

  useEffect(() => {
    const onFirstInteract = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', onFirstInteract);
      window.removeEventListener('touchstart', onFirstInteract);
      window.removeEventListener('mousedown', onFirstInteract);
      window.removeEventListener('keydown', onFirstInteract);
    };
    window.addEventListener('pointerdown', onFirstInteract, { once: true });
    window.addEventListener('touchstart', onFirstInteract, { once: true, passive: true });
    window.addEventListener('mousedown', onFirstInteract, { once: true });
    window.addEventListener('keydown', onFirstInteract, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onFirstInteract);
      window.removeEventListener('touchstart', onFirstInteract);
      window.removeEventListener('mousedown', onFirstInteract);
      window.removeEventListener('keydown', onFirstInteract);
    };
  }, []);

  useEffect(() => {
    if (screen !== 'game' || gameMode !== 'single') return;
    if (!isMobileViewport || !isNewSinglePlayerProfile) return;
    try {
      if (localStorage.getItem(MOBILE_CONTROLS_HINT_SEEN_KEY) === '1') return;
      localStorage.setItem(MOBILE_CONTROLS_HINT_SEEN_KEY, '1');
    } catch {
      // Ignore localStorage access issues and still show the hint once this session.
    }
    showToast('Mobile tip: Tap selected piece to rotate. Press and hold to flip.', 'neutral');
  }, [gameMode, isMobileViewport, isNewSinglePlayerProfile, screen, showToast]);

  useEffect(() => {
    if (!isMultiplayerLocked) {
      lastCountdownSoundRef.current = null;
      return;
    }
    if (multiplayerCountdownSeconds <= 0) return;
    if (lastCountdownSoundRef.current === multiplayerCountdownSeconds) return;
    lastCountdownSoundRef.current = multiplayerCountdownSeconds;
    playSoundCue('countdown_tick');
  }, [isMultiplayerLocked, multiplayerCountdownSeconds]);

  useEffect(() => {
    if (gameMode !== 'multiplayer' || isMultiplayerLocked || isGameOver || isWin || isShowingSolution) {
      lastLowTimeSoundRef.current = null;
      return;
    }
    if (!isActive) return;
    if (timeLeft <= 0 || timeLeft > 10) return;
    if (lastLowTimeSoundRef.current === timeLeft) return;
    if (timeLeft === 10 || timeLeft <= 5) {
      playSoundCue('time_low');
      lastLowTimeSoundRef.current = timeLeft;
    }
  }, [gameMode, isMultiplayerLocked, isGameOver, isWin, isShowingSolution, isActive, timeLeft]);

  useEffect(() => {
    if (gameMode !== 'multiplayer') {
      lastRoundEndSoundKeyRef.current = null;
      return;
    }
    if (!(isGameOver || isWin) || isShowingSolution) return;
    const key = `${activeChallenge?.code ?? 'no-code'}:${activeRoom?.roundNumber ?? 0}:${isWin ? 'win' : 'end'}`;
    if (lastRoundEndSoundKeyRef.current === key) return;
    lastRoundEndSoundKeyRef.current = key;
    playSoundCue('round_end');
  }, [gameMode, isGameOver, isWin, isShowingSolution, activeChallenge?.code, activeRoom?.roundNumber]);

  // Multiplayer timer uses server deadline so everyone shares the same end moment.
  useEffect(() => {
    if (!isMultiplayerRound && !isArenaRound) return;
    if (multiplayerRoundDeadlineMs === null && multiplayerRoundStartMs === null) return;
    if (isWin || isGameOver || isShowingSolution || isSolving || isGenerating) return;
    let didTimeout = false;

    const syncRemaining = () => {
      const remaining = multiplayerRoundDeadlineMs !== null
        ? Math.max(0, Math.floor((multiplayerRoundDeadlineMs - Date.now()) / 1000))
        : Math.max(0, config.timeSeconds - Math.max(0, Math.floor((Date.now() - (multiplayerRoundStartMs ?? Date.now())) / 1000)));
      setTimeLeft((prev) => (prev === remaining ? prev : remaining));

      if (isMultiplayerLocked) return;
      if (remaining <= 0 && !didTimeout) {
        didTimeout = true;
        setIsGameOver(true);
        setIsActive(false);
        if (gameMode === 'arena') {
          void submitArenaResult(false, 0);
        } else {
          void submitChallengeResult(false, 0, false);
        }
        trackEvent('level_failed', {
          level,
          reason: 'timeout',
          mode: gameMode,
          elapsed_seconds: Math.max(0, Math.round((Date.now() - levelStartRef.current) / 1000)),
        });
        return;
      }

      setIsActive(true);
    };

    syncRemaining();
    const interval = window.setInterval(syncRemaining, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, [
    isMultiplayerRound,
    isArenaRound,
    multiplayerRoundDeadlineMs,
    multiplayerRoundStartMs,
    isMultiplayerLocked,
    isWin,
    isGameOver,
    isShowingSolution,
    isSolving,
    isGenerating,
    config.timeSeconds,
    level,
    gameMode,
    submitChallengeResult,
    submitArenaResult,
  ]);

  // Single-player timer
  useEffect(() => {
    if (gameMode !== 'single') return;
    let interval: ReturnType<typeof setInterval>;
    if (isActive && timeLeft > 0 && !isWin && !isShowingSolution && !isSolving && !isGenerating) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
        updatePlayerStats((prev) => ({ ...prev, totalPlaySeconds: prev.totalPlaySeconds + 1 }));
      }, 1000);
    } else if (timeLeft === 0 && !isWin && !isGameOver && !isShowingSolution && !isSolving && !isGenerating) {
      setIsGameOver(true);
      setIsActive(false);
      updatePlayerStats((prev) => ({ ...prev, losses: prev.losses + 1 }));
      trackEvent('level_failed', {
        level,
        reason: 'timeout',
        mode: 'single',
        elapsed_seconds: Math.max(0, Math.round((Date.now() - levelStartRef.current) / 1000)),
      });
    }
    return () => clearInterval(interval);
  }, [isActive, timeLeft, isWin, isGameOver, isShowingSolution, isSolving, isGenerating, updatePlayerStats, level, gameMode]);

  // Win condition
  useEffect(() => {
    if (placedPieces.length === totalPiecesCount && !isShowingSolution && !isGameOver && !isWin) {
      const occupied = new Set<string>(blockedCellSet); // pre-fill blocked cells to detect overlaps
      let allInBounds = true;
      let overlap = false;

      placedPieces.forEach((p) => {
        p.currentShape.forEach((cell) => {
          const x = p.position.x + cell.x;
          const y = p.position.y + cell.y;
          if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) allInBounds = false;
          const key = `${x},${y}`;
          if (occupied.has(key)) overlap = true;
          occupied.add(key);
        });
      });

      // occupied now includes blocked cells + piece cells; total must equal grid area
      if (allInBounds && !overlap && occupied.size === gridWidth * gridHeight) {
        const previousBest = bestTimes[level];
        const isNewBest = previousBest === undefined || timeLeft > previousBest;
        const elapsedSeconds = Math.max(0, Math.round((Date.now() - levelStartRef.current) / 1000));
        setIsWin(true);
        setIsActive(false);
        setSelectedPieceId(null);
        setDraggedPiece(null);
        if (gameMode === 'single') {
          markLevelComplete(level);
          saveBestTime(level, timeLeft);
          updatePlayerStats((prev) => ({ ...prev, wins: prev.wins + 1 }));
        } else if (gameMode === 'arena') {
          void submitArenaResult(true, timeLeft);
        } else {
          void submitChallengeResult(true);
        }
        trackEvent('level_completed', {
          level,
          time_left: timeLeft,
          elapsed_seconds: elapsedSeconds,
          mode: gameMode,
          new_best: isNewBest,
        });
        if (gameMode === 'single' && isNewBest) {
          showToast('New best time recorded.', 'success');
        }
        if (gameMode === 'single' && level < MAX_LEVEL) {
          setCompletedThisSession((prev) => {
            const next = prev + 1;
            const shouldShowAdBreak = !isProMember && !isFirstSession && next % AD_BREAK_INTERVAL === 0;
            if (shouldShowAdBreak) {
              setAdBreakLevel(level + 1);
              trackEvent('ad_break_eligible', {
                level,
                next_level: level + 1,
                completed_in_session: next,
                interval: AD_BREAK_INTERVAL,
              });
            }
            return next;
          });
        }
      }
    }
  }, [placedPieces, isShowingSolution, isGameOver, totalPiecesCount, gridWidth, gridHeight, targetCells, level, timeLeft, markLevelComplete, saveBestTime, updatePlayerStats, showToast, completedLevels, bestTimes, isFirstSession, gameMode, submitChallengeResult, submitArenaResult, isProMember]);

  const handleRotate = useCallback((id: string) => {
    unlockAudio();
    setPlacedPieces((prev) => {
      if (!prev.some(p => p.id === id)) return prev;
      return prev.map((p) => p.id === id ? { ...p, currentShape: rotateShape(p.currentShape), rotation: (p.rotation + 90) % 360 } : p);
    });
    setAvailablePieces((prev) => {
      if (!prev.some(p => p.id === id)) return prev;
      return prev.map((p) => p.id === id ? { ...p, shape: rotateShape(p.shape) } : p);
    });
    playSoundCue('piece_rotate');
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(8);
      } catch {
        // Ignore unsupported / blocked vibration calls.
      }
    }
  }, []);

  const handleFlip = useCallback((id: string) => {
    unlockAudio();
    setPlacedPieces((prev) => {
      if (!prev.some(p => p.id === id)) return prev;
      return prev.map((p) => p.id === id ? { ...p, currentShape: flipShape(p.currentShape), isFlipped: !p.isFlipped } : p);
    });
    setAvailablePieces((prev) => {
      if (!prev.some(p => p.id === id)) return prev;
      return prev.map((p) => p.id === id ? { ...p, shape: flipShape(p.shape) } : p);
    });
    playSoundCue('piece_flip');
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([10, 25, 10]);
      } catch {
        // Ignore unsupported / blocked vibration calls.
      }
    }
  }, []);

  const returnToStash = useCallback((id: string) => {
    // Read from state updater to avoid stale closure over placedPieces
    setPlacedPieces((prev) => {
      const piece = prev.find((p) => p.id === id);
      if (!piece) return prev;
      // Use currentShape so rotation/flip is preserved when returning to stash
      setAvailablePieces((ap) => {
        if (ap.some((p) => p.id === id)) return ap;
        return [
          ...ap,
          {
            id: piece.id,
            name: piece.name,
            shape: orientShapeForStash(piece.currentShape),
            color: piece.color,
          },
        ];
      });
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const resetPiecesToStash = useCallback(() => {
    const allIds = stashOrderRef.current.length > 0
      ? stashOrderRef.current
      : Array.from(new Set([...availablePieces.map((piece) => piece.id), ...placedPieces.map((piece) => piece.id)]));

    const restoredPieces = allIds
      .map((id) => PIECE_BY_ID[id])
      .filter((piece): piece is Piece => Boolean(piece))
      .map((piece) => ({
        ...piece,
        shape: orientShapeForStash(piece.shape),
      }));

    setPlacedPieces([]);
    setAvailablePieces(restoredPieces);
    setSelectedPieceId(null);
    setDraggedPiece(null);
    dragStartRef.current = null;
    isDraggingRef.current = false;
    const activeTrack = pointerTrackRef.current;
    if (activeTrack?.longPressTimer) {
      window.clearTimeout(activeTrack.longPressTimer);
    }
    pointerTrackRef.current = null;
  }, [availablePieces, placedPieces]);

  // Keyboard shortcuts — work during drag too
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedPieceId || isGameOver || isWin) return;
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleRotate(selectedPieceId);
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleFlip(selectedPieceId);
      } else if (e.key === 'Escape') {
        if (isDraggingRef.current) {
          isDraggingRef.current = false;
          dragStartRef.current = null;
          setDraggedPiece(null);
        }
        returnToStash(selectedPieceId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPieceId, isGameOver, isWin, handleRotate, handleFlip, returnToStash]);

  // ── Drag system ─────────────────────────────────────────────────────────
  // mousedown/touchstart → select + immediately start drag
  // mousemove/touchmove  → update piece position
  // mouseup/touchend     → drop piece where it is

  // Compute grid position from screen coords — single source of truth
  const screenToGrid = (clientX: number, clientY: number): Point => {
    const containerRect = containerRef.current!.getBoundingClientRect();
    const x = clientX - containerRect.left - gridPadding - dragOffsetRef.current.x;
    const y = clientY - containerRect.top - gridPadding - dragOffsetRef.current.y;
    return { x: Math.round(x / cellSize), y: Math.round(y / cellSize) };
  };

  const releaseCapturedPointer = useCallback((pointerId: number | null) => {
    const surface = gameSurfaceRef.current;
    if (!surface || pointerId === null) return;
    try {
      if (surface.hasPointerCapture(pointerId)) {
        surface.releasePointerCapture(pointerId);
      }
    } catch {
      // Pointer may already be released.
    }
  }, []);

  const clearPointerTrack = useCallback(() => {
    const track = pointerTrackRef.current;
    if (track?.longPressTimer) {
      window.clearTimeout(track.longPressTimer);
    }
    pointerTrackRef.current = null;
  }, []);

  const constrainDragPointer = useCallback((clientX: number, clientY: number, pieceId: string) => {
    const activePiece = placedPieces.find((piece) => piece.id === pieceId) ?? availablePieces.find((piece) => piece.id === pieceId);
    if (!activePiece) return { clientX, clientY };

    const shape = 'currentShape' in activePiece ? activePiece.currentShape : activePiece.shape;
    const shapeSize = getShapeSize(shape);
    const pieceWidth = shapeSize.width * cellSize;
    const pieceHeight = shapeSize.height * cellSize;
    const margin = 8;

    const minLeft = margin;
    const maxLeft = Math.max(minLeft, window.innerWidth - pieceWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - pieceHeight - margin);

    const left = Math.min(maxLeft, Math.max(minLeft, clientX - dragOffsetRef.current.x));
    const top = Math.min(maxTop, Math.max(margin, clientY - dragOffsetRef.current.y));

    return {
      clientX: left + dragOffsetRef.current.x,
      clientY: top + dragOffsetRef.current.y,
    };
  }, [availablePieces, placedPieces]);

  const handlePointerDown = (
    clientX: number,
    clientY: number,
    id: string,
    isFromGrid: boolean,
    target: HTMLElement,
    pointerId: number,
  ) => {
    if (isGameOver || isWin) return;
    if (isMultiplayerLocked) {
      showToast('Match will start together after countdown.', 'neutral');
      return;
    }
    if (!isActive) setIsActive(true);
    setSelectedPieceId(id);

    if (isFromGrid) {
      // For grid pieces the wrapper is 0×0 at the piece origin — offset is
      // simply the distance from that anchor to the touch point.
      const rect = target.getBoundingClientRect();
      const offsetX = clientX - rect.left;
      const offsetY = clientY - rect.top;
      dragOffsetRef.current = { x: offsetX, y: offsetY };
      dragStartRef.current = { x: clientX, y: clientY, id, isFromGrid, target, pointerId };
      isDraggingRef.current = true;
      setDraggedPiece({ id, offset: { x: offsetX, y: offsetY } });
    } else {
      // Stash pieces: rendered at stashCellSize but transition to board cellSize
      // when picked up. We compute the offset relative to the piece's (0,0) cell
      // in stash coordinates, then scale to board coordinates so the finger lands
      // on the same RELATIVE position of the (now larger) piece.
      const p = availablePieces.find((piece) => piece.id === id);
      if (!p) return;

      const wrapperPaddingStash = Math.max(3, Math.round(stashCellSize * 0.14));
      const rect = target.getBoundingClientRect();
      // Position within the stash slot (origin at slot top-left), then subtract
      // the slot's own padding so we get coordinates relative to the piece's (0,0) cell.
      const stashLocalX = clientX - rect.left - wrapperPaddingStash;
      const stashLocalY = clientY - rect.top - wrapperPaddingStash;
      // Scale stash-space coordinates to board-space (piece grows from stashCellSize → cellSize).
      const scale = cellSize / stashCellSize;
      const offsetX = stashLocalX * scale;
      const offsetY = stashLocalY * scale;
      dragOffsetRef.current = { x: offsetX, y: offsetY };
      dragStartRef.current = { x: clientX, y: clientY, id, isFromGrid, target, pointerId };
      isDraggingRef.current = true;
      setDraggedPiece({ id, offset: { x: offsetX, y: offsetY } });

      const containerRect = containerRef.current?.getBoundingClientRect();
      const initX = containerRect ? Math.round((clientX - containerRect.left - gridPadding - offsetX) / cellSize) : 0;
      const initY = containerRect ? Math.round((clientY - containerRect.top - gridPadding - offsetY) / cellSize) : 0;
      setPlacedPieces((prev) => {
        if (prev.some((piece) => piece.id === id)) return prev;
        return [
          ...prev,
          { ...p, position: { x: initX, y: initY }, currentShape: p.shape, rotation: 0, isFlipped: false },
        ];
      });
      setAvailablePieces((prev) => prev.filter((p) => p.id !== id));
    }
  };

  const handlePointerMove = (clientX: number, clientY: number, pointerId: number) => {
    if (!isDraggingRef.current || !containerRef.current || !dragStartRef.current) return;
    if (dragStartRef.current.pointerId !== pointerId) return;
    const dragId = dragStartRef.current.id;
    const constrained = constrainDragPointer(clientX, clientY, dragId);
    const { x: gridX, y: gridY } = screenToGrid(constrained.clientX, constrained.clientY);
    setPlacedPieces((prev) =>
      prev.map((p) => p.id === dragId ? { ...p, position: { x: gridX, y: gridY } } : p)
    );
  };

  const handlePointerUp = useCallback((pointerId?: number | null) => {
    if (isDraggingRef.current) {
      setDraggedPiece(null);
    }
    releaseCapturedPointer(pointerId ?? dragStartRef.current?.pointerId ?? null);
    dragStartRef.current = null;
    isDraggingRef.current = false;
    clearPointerTrack();
  }, [clearPointerTrack, releaseCapturedPointer]);

  // ── Global event listeners ────────────────────────────────────────────────
  // Touch events are dispatched to the ORIGINAL target element, not whatever
  // is under the finger.  When a stash piece is picked up it unmounts (moved
  // to placedPieces), so React container handlers never see the subsequent
  // touchmove/touchend.  Window-level listeners always work.
  //
  // We intentionally do NOT attach onTouchMove / onTouchEnd on the React
  // container — all touch tracking goes through the single window path below
  // to avoid dual-handler race conditions.
  useEffect(() => {
    const shouldUseLegacyTouchFallback = typeof PointerEvent === 'undefined';
    if (!shouldUseLegacyTouchFallback) return;
    const onWindowTouchMoveLegacy = (event: TouchEvent) => {
      if (screen !== 'game') return;
      // Prevent scroll while any touch interaction is active
      if (isDraggingRef.current || touchTrackRef.current) {
        event.preventDefault();
      }
      if (!isDraggingRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;

      const track = touchTrackRef.current;
      if (track && !track.moved) {
        const distance = Math.hypot(touch.clientX - track.startX, touch.clientY - track.startY);
        if (distance >= TOUCH_DRAG_THRESHOLD_PX) {
          track.moved = true;
        }
      }
      handlePointerMove(touch.clientX, touch.clientY, dragStartRef.current?.pointerId ?? -1);
    };

    const onWindowTouchEnd = () => {
      if (screen !== 'game') return;
      const track = touchTrackRef.current;
      touchTrackRef.current = null;

      // Tap (no movement) on a grid piece → rotate
      if (track && track.isFromGrid && !track.moved && !isGameOver && !isWin) {
        handleRotate(track.id);
      }
      handlePointerUp(dragStartRef.current?.pointerId ?? null);
    };

    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', onWindowTouchMoveLegacy, { passive: false });
    window.addEventListener('touchend', onWindowTouchEnd);
    window.addEventListener('touchcancel', onWindowTouchEnd);
    return () => {
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', onWindowTouchMoveLegacy);
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchEnd);
    };
  }, [handlePointerUp, screen, isGameOver, isWin, handleRotate]);

  // Lock page scroll on game screen for better mobile playability.
  useEffect(() => {
    if (screen !== 'game') return;
    const shouldLockScroll = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 768px)').matches);
    if (!shouldLockScroll) return;

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevOverscroll = document.documentElement.style.overscrollBehavior;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.overscrollBehavior = 'none';

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.documentElement.style.overscrollBehavior = prevOverscroll;
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== 'game') return;
    const shouldResetViewport = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(max-width: 768px)').matches);
    if (!shouldResetViewport) return;

    const resetViewportToTop = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      gameSurfaceRef.current?.scrollIntoView({ block: 'start', inline: 'nearest' });
    };

    resetViewportToTop();
    const rafId = window.requestAnimationFrame(resetViewportToTop);
    const timeoutId = window.setTimeout(resetViewportToTop, 120);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [screen, level, gameMode, activeChallenge?.code]);

  useEffect(() => {
    return () => { touchTrackRef.current = null; };
  }, []);

  const onMouseDown = (e: React.MouseEvent, id: string, isFromGrid: boolean) => {
    e.preventDefault(); // Prevent native drag (🚫 cursor)
    handlePointerDown(e.clientX, e.clientY, id, isFromGrid, e.currentTarget as HTMLElement, 0);
  };
  const onMouseMove = (e: React.MouseEvent) => handlePointerMove(e.clientX, e.clientY, dragStartRef.current?.pointerId ?? 0);
  const onMouseUp = handlePointerUp;

  const onTouchStart = (e: React.TouchEvent, id: string, isFromGrid: boolean) => {
    e.preventDefault();
    const touch = e.touches[0];
    const target = e.currentTarget as HTMLElement;

    // If already dragging a different piece, end that drag synchronously.
    if (isDraggingRef.current) {
      dragStartRef.current = null;
      isDraggingRef.current = false;
      setDraggedPiece(null);
    }
    touchTrackRef.current = null;

    // Start the new drag immediately — the piece follows the finger from
    // the very first touchmove, with no threshold delay.
    handlePointerDown(touch.clientX, touch.clientY, id, isFromGrid, target, 0);

    // Record touch start position so we can distinguish tap vs drag later.
    touchTrackRef.current = {
      pointerId: 0,
      id,
      isFromGrid,
      pointerType: 'legacy-touch',
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      moved: false,
      longPressTriggered: false,
      longPressTimer: null,
    };
  };

  const onPiecePointerDown = (e: React.PointerEvent<HTMLElement>, id: string, isFromGrid: boolean) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();

    // Always clean up any existing drag state before starting a new one.
    // This handles: different pointerId, same pointerId reused by browser,
    // or stale state from a missed pointerup/pointercancel.
    if (dragStartRef.current || isDraggingRef.current) {
      releaseCapturedPointer(dragStartRef.current?.pointerId ?? null);
      clearPointerTrack();
      dragStartRef.current = null;
      isDraggingRef.current = false;
      setDraggedPiece(null);
    }

    const surface = gameSurfaceRef.current;
    if (surface) {
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        // Continue without capture if the browser rejects it.
      }
    }

    handlePointerDown(e.clientX, e.clientY, id, isFromGrid, e.currentTarget, e.pointerId);

    const track: PointerTrack = {
      pointerId: e.pointerId,
      id,
      isFromGrid,
      pointerType: e.pointerType === 'mouse' || e.pointerType === 'pen' ? e.pointerType : 'touch',
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      longPressTriggered: false,
      longPressTimer: null,
    };

    if (e.pointerType !== 'mouse' && isFromGrid) {
      track.longPressTimer = window.setTimeout(() => {
        const current = pointerTrackRef.current;
        if (!current || current.pointerId !== e.pointerId || current.moved || current.longPressTriggered) return;
        current.longPressTriggered = true;
        handleFlip(id);
      }, TOUCH_LONG_PRESS_MS);
    }

    pointerTrackRef.current = track;
  };

  const onSurfacePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = pointerTrackRef.current;
    if (!track || track.pointerId !== e.pointerId) return;

    const distance = Math.hypot(e.clientX - track.startX, e.clientY - track.startY);
    if (!track.moved && distance >= TOUCH_DRAG_THRESHOLD_PX) {
      track.moved = true;
      if (track.longPressTimer) {
        window.clearTimeout(track.longPressTimer);
        track.longPressTimer = null;
      }
    }

    track.lastX = e.clientX;
    track.lastY = e.clientY;
    handlePointerMove(e.clientX, e.clientY, e.pointerId);
  };

  const onSurfacePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const track = pointerTrackRef.current;
    if (track && track.pointerId === e.pointerId) {
      if (track.longPressTimer) {
        window.clearTimeout(track.longPressTimer);
      }
      if (
        track.pointerType !== 'mouse'
        && !track.moved
        && !track.longPressTriggered
        && track.isFromGrid
        && !isGameOver
        && !isWin
      ) {
        handleRotate(track.id);
      }
    }

    handlePointerUp(e.pointerId);
  };

  const onSurfacePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    handlePointerUp(e.pointerId);
  };

  const onSurfaceLostPointerCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    // If we lost capture for the active drag pointer (e.g. browser cancelled it),
    // clean up to avoid stale state that blocks subsequent interactions.
    if (dragStartRef.current && dragStartRef.current.pointerId === e.pointerId) {
      handlePointerUp(e.pointerId);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleShowSolution = () => {
    if (gameMode === 'multiplayer') {
      showToast('Solutions are disabled in multiplayer.', 'warning');
      return;
    }
    trackEvent('solution_requested', { level, from_game_over: isGameOver });
    setIsSolving(true);
    setIsActive(false);
    setTimeout(() => {
      const allPieces = [
        ...availablePieces,
        ...placedPieces.map((p) => ({ id: p.id, name: p.name, shape: p.shape, color: p.color })),
      ];
      const solution = solveKatamino(gridWidth, gridHeight, allPieces, config.blockedCells.length > 0 ? config.blockedCells : undefined);
      if (solution) {
        trackEvent('solution_shown', { level });
        setIsShowingSolution(true);
        setIsGameOver(false);
        setIsWin(false);
        setPlacedPieces(solution.map((p) => ({ ...p, rotation: 0, isFlipped: false })));
        setAvailablePieces([]);
        updatePlayerStats((prev) => ({ ...prev, hintsUsed: prev.hintsUsed + 1 }));
      } else {
        setErrorMessage('No solution was found for this piece set.');
      }
      setIsSolving(false);
    }, 100);
  };

  const goToLevelSelect = () => {
    setIsActive(false);
    setIsScoreboardOpen(false);
    if (gameMode === 'multiplayer') {
      setScreen('multiplayer');
      return;
    }
    setScreen('levelSelect');
  };

  const handleNextLevel = useCallback(() => {
    const nextLevel = level + 1;
    if (adBreakLevel === nextLevel) {
      setQueuedNextLevel(nextLevel);
      setIsAdBreakVisible(true);
      trackEvent('ad_break_opened', { current_level: level, next_level: nextLevel });
      return;
    }
    initGame(nextLevel, 'next');
  }, [adBreakLevel, initGame, level]);

  const handleAdBreakContinue = useCallback(() => {
    if (queuedNextLevel === null) {
      setIsAdBreakVisible(false);
      return;
    }
    trackEvent('ad_break_completed', { next_level: queuedNextLevel });
    setIsAdBreakVisible(false);
    setAdBreakLevel(null);
    const targetLevel = queuedNextLevel;
    setQueuedNextLevel(null);
    initGame(targetLevel, 'next');
  }, [queuedNextLevel, initGame]);

  const startLevel = useCallback((lvl: number) => {
    setActiveChallenge(null);
    setActiveRoom(null);
    setActiveLeaderboard([]);
    setNextRoundReadySubmitted(false);
    setNextRoundReadyCount(0);
    setGameMode('single');
    setMatchSnapshot(null);
    setHasSubmittedMatchResult(false);
    setIsScoreboardOpen(false);
    initGame(lvl, 'start', { mode: 'single' });
    setScreen('game');
  }, [initGame]);

  const continueFromLastLevel = useCallback(() => {
    setActiveChallenge(null);
    setActiveRoom(null);
    setActiveLeaderboard([]);
    setNextRoundReadySubmitted(false);
    setNextRoundReadyCount(0);
    setGameMode('single');
    setMatchSnapshot(null);
    setHasSubmittedMatchResult(false);
    initGame(singlePlayerLevel, 'start', { mode: 'single' });
    setScreen('game');
  }, [initGame, singlePlayerLevel]);

  const handleMenuSinglePlayer = useCallback(() => {
    unlockAudio();
    const hasSinglePlayerProgress = completedLevels.size > 0
      || Object.keys(bestTimes).length > 0
      || singlePlayerLevel > 1
      || playerStats.gamesStarted > 0;
    if (!hasSinglePlayerProgress) {
      startLevel(1);
      return;
    }
    setScreen('levelSelect');
  }, [bestTimes, completedLevels, playerStats.gamesStarted, singlePlayerLevel, startLevel]);

  const startChallengeGame = useCallback(async (snapshot: MultiplayerRoomSnapshot) => {
    const round = snapshot.activeRound;
    if (!round) return;
    const challengeState: ActiveChallengeState = {
      code: snapshot.room.code,
      levelId: round.levelId,
      puzzleSeed: round.puzzleSeed,
      isRanked: snapshot.room.isRanked,
      startAt: round.startAt,
      winnerUserId: null,
    };
    setActiveRoom({
      code: snapshot.room.code,
      totalRounds: snapshot.room.totalRounds,
      roundNumber: round.roundNumber,
      maxPlayers: snapshot.room.maxPlayers,
      championUserId: snapshot.room.championUserId,
    });
    setActiveLeaderboard(
      snapshot.players.map((player) => ({
        userId: player.userId,
        displayName: player.displayName,
        totalPoints: player.totalPoints,
      })),
    );
    setActiveChallenge(challengeState);
    setMatchSnapshot(null);
    setHasSubmittedMatchResult(false);
    setNextRoundReadySubmitted(false);
    setNextRoundReadyCount(0);
    await initGame(round.levelId, 'start', {
      mode: 'multiplayer',
      puzzleSeed: round.puzzleSeed,
      startAt: round.startAt,
      deadlineAt: round.deadlineAt,
      timeoutSeconds: round.timeoutSeconds,
    });
    setScreen('game');
    const msLeft = Date.parse(round.startAt) - Date.now();
    if (msLeft > 0) {
      showToast(`Round starts in ${Math.ceil(msLeft / 1000)}s`, 'neutral');
    }
  }, [initGame, showToast]);

  const handleNextMultiplayerRound = useCallback(async () => {
    if (!activeRoom) return;
    try {
      const latestRoom = await readyMultiplayerRoomNextRound(activeRoom.code);
      setActiveLeaderboard(
        latestRoom.players.map((player) => ({
          userId: player.userId,
          displayName: player.displayName,
          totalPoints: player.totalPoints,
        })),
      );
      const targetRound = activeRoom.roundNumber + 1;
      const readyCount = latestRoom.players.filter((player) => player.readyForRound >= targetRound).length;
      setNextRoundReadySubmitted(true);
      setNextRoundReadyCount(readyCount);
      const nextRound = latestRoom.activeRound;
      if (!nextRound) {
        setScreen('multiplayer');
        return;
      }
      if (nextRound.roundNumber <= activeRoom.roundNumber && latestRoom.room.status !== 'finished') {
        showToast(`Waiting for players... Ready ${readyCount}/${latestRoom.players.length}`, 'neutral');
        return;
      }
      await startChallengeGame(latestRoom);
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    }
  }, [activeRoom, showToast, startChallengeGame]);

  const handleGiveUpRound = useCallback(() => {
    if (gameMode !== 'multiplayer') return;
    if (hasSubmittedMatchResult || isGameOver || isWin) return;
    setIsActive(false);
    setIsGameOver(true);
    showToast('You gave up this round.', 'warning');
    void submitChallengeResult(false, timeLeft, false);
  }, [gameMode, hasSubmittedMatchResult, isGameOver, isWin, showToast, submitChallengeResult, timeLeft]);

  // ── Screen routing ──
  if (screen === 'menu') {
    return (
      <>
        <CornerAccountNav
          user={authUser}
          resolvedTheme={resolvedTheme}
          onProfile={() => setScreen('profile')}
          onLogout={() => { void handleLogout(); }}
        />
        <MenuScreen
          onContinue={continueFromLastLevel}
          continueLevel={singlePlayerLevel}
          onSinglePlayer={handleMenuSinglePlayer}
          onStats={() => setScreen('stats')}
          onMultiplayer={() => setScreen('multiplayer')}
          onArena={() => setScreen('arena')}
          canOpenAdmin={Boolean(authUser?.isAdmin)}
          onAdmin={() => setScreen('admin')}
          resolvedTheme={resolvedTheme}
        />
        {!consent && (
          <ConsentBanner
            onAcceptPersonalized={() => applyConsent(true)}
            onAcceptEssential={() => applyConsent(false)}
          />
        )}
      </>
    );
  }

  if (screen === 'multiplayer') {
    return (
      <>
        <MultiplayerScreen
          user={authUser}
          onBack={() => setScreen('menu')}
          onStartChallenge={startChallengeGame}
          onGuestBootstrap={handleGuestLogin}
          onGuestNicknameUpdate={handleGuestNicknameUpdate}
          multiplayerStats={multiplayerStats}
          resolvedTheme={resolvedTheme}
          onToast={showToast}
        />
        {!consent && (
          <ConsentBanner
            onAcceptPersonalized={() => applyConsent(true)}
            onAcceptEssential={() => applyConsent(false)}
          />
        )}
      </>
    );
  }

  if (screen === 'arena') {
    return (
      <>
        <ArenaScreen
          user={authUser}
          profile={arenaProfile}
          phase={arenaPhase}
          match={arenaMatch}
          queueSeconds={arenaQueueSeconds}
          countdown={arenaCountdown}
          onBack={() => {
            if (arenaPhase === 'queuing') void handleArenaLeave();
            setScreen('menu');
          }}
          onJoin={handleArenaJoin}
          onLeave={handleArenaLeave}
          onPlayAgain={() => {
            setArenaMatch(null);
            setArenaResultSubmitted(false);
            setArenaPhase('idle');
          }}
          resolvedTheme={resolvedTheme}
        />
        {!consent && (
          <ConsentBanner
            onAcceptPersonalized={() => applyConsent(true)}
            onAcceptEssential={() => applyConsent(false)}
          />
        )}
      </>
    );
  }

  if (screen === 'levelSelect') {
    return (
      <>
        <LevelSelectScreen
          completedLevels={completedLevels}
          bestTimes={bestTimes}
          onSelectLevel={startLevel}
          onBack={() => setScreen('menu')}
          onStats={() => setScreen('stats')}
          resolvedTheme={resolvedTheme}
        />
        {!consent && (
          <ConsentBanner
            onAcceptPersonalized={() => applyConsent(true)}
            onAcceptEssential={() => applyConsent(false)}
          />
        )}
      </>
    );
  }

  if (screen === 'stats') {
    return (
      <>
        <StatsScreen
          completedLevels={completedLevels}
          bestTimes={bestTimes}
          playerStats={playerStats}
          onBack={() => setScreen('menu')}
          onPlay={() => setScreen('levelSelect')}
          resolvedTheme={resolvedTheme}
        />
        {!consent && (
          <ConsentBanner
            onAcceptPersonalized={() => applyConsent(true)}
            onAcceptEssential={() => applyConsent(false)}
          />
        )}
      </>
    );
  }

  if (screen === 'profile') {
    return (
      <>
        <ProfileScreen
          user={authUser}
          authLoading={authLoading}
          authError={authError}
          syncStateLabel={cloudSyncing ? 'Syncing to cloud...' : 'Cloud sync ready'}
          googleEnabled={googleEnabled}
          googleSlotRef={googleButtonRef}
          themeMode={themeMode}
          resolvedTheme={resolvedTheme}
          onThemeChange={setThemeMode}
          onGuestLogin={handleGuestLogin}
          onNicknameLogin={handleNicknameLogin}
          onNicknameRegister={handleNicknameRegister}
          onLogout={handleLogout}
          onBack={() => setScreen('menu')}
          onResendVerification={handleResendVerification}
          onOpenAdmin={() => setScreen('admin')}
        />
        {!consent && (
          <ConsentBanner
            onAcceptPersonalized={() => applyConsent(true)}
            onAcceptEssential={() => applyConsent(false)}
          />
        )}
      </>
    );
  }

  if (screen === 'admin') {
    return (
      <>
        <AdminScreen
          user={authUser}
          users={filteredAdminUsers}
          selectedUserIds={selectedAdminUserIds}
          loading={adminLoading}
          search={adminSearch}
          providerFilter={adminProviderFilter}
          membershipFilter={adminMembershipFilter}
          verificationFilter={adminVerificationFilter}
          onSearchChange={setAdminSearch}
          onProviderFilterChange={setAdminProviderFilter}
          onMembershipFilterChange={setAdminMembershipFilter}
          onVerificationFilterChange={setAdminVerificationFilter}
          onToggleUserSelection={handleToggleAdminUserSelection}
          onToggleSelectAll={handleToggleSelectAllAdminUsers}
          onRefresh={() => { void loadAdminUsers(adminSearch); }}
          onSetMembership={handleAdminMembershipChange}
          onBulkSetMembership={handleBulkAdminMembershipChange}
          onBack={() => setScreen('profile')}
        />
        {!consent && (
          <ConsentBanner
            onAcceptPersonalized={() => applyConsent(true)}
            onAcceptEssential={() => applyConsent(false)}
          />
        )}
      </>
    );
  }

  // ── Game screen ──
  const dragValid = isDragValid();
  const tier = getTier(level);
  const availableById = new Map<string, Piece>(availablePieces.map((piece) => [piece.id, piece] as const));
  const pieceById = new Map<string, Piece>([
    ...placedPieces.map((piece) => [piece.id, piece] as const),
    ...availablePieces.map((piece) => [piece.id, piece] as const),
  ]);
  const stashRenderOrder = (() => {
    const currentIds = Array.from(new Set([
      ...availablePieces.map((piece) => piece.id),
      ...placedPieces.map((piece) => piece.id),
    ]));

    const orderSource = stashSlotOrder.length > 0 ? stashSlotOrder : currentIds;
    const nextOrder = orderSource.filter((id, index, arr) => (
      arr.indexOf(id) === index && currentIds.includes(id)
    ));

    for (const id of currentIds) {
      if (!nextOrder.includes(id)) nextOrder.push(id);
    }
    return nextOrder;
  })();

  return (
    <div
      ref={gameSurfaceRef}
      className={cn(
        'min-h-screen font-sans p-4 md:p-8 flex flex-col items-center select-none touch-none overscroll-none',
        resolvedTheme === 'dark' ? 'bg-[#0b0f17] text-white' : 'bg-[#f5f5f5] text-[#1a1a1a]',
      )}
      onPointerMove={onSurfacePointerMove}
      onPointerUp={onSurfacePointerUp}
      onPointerCancel={onSurfacePointerCancel}
      onLostPointerCapture={onSurfaceLostPointerCapture}
    >
      <CornerAccountNav
        user={authUser}
        resolvedTheme={resolvedTheme}
        onProfile={() => setScreen('profile')}
        onLogout={() => { void handleLogout(); }}
      />
      {/* Header */}
      <div className="w-full max-w-4xl flex flex-col md:flex-row justify-between items-center mb-4 md:mb-8 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={goToLevelSelect}
            className={cn('p-3 rounded-xl border transition-all active:scale-95', resolvedTheme === 'dark' ? 'bg-white/10 border-white/10 hover:bg-white/15' : 'bg-white border-black/10 hover:bg-gray-100')}
            aria-label={gameMode === 'multiplayer' ? 'Back to multiplayer' : 'Back to level select'}
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-1">PENTABLOCKS</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn('text-white text-[10px] font-bold px-2 py-0.5 rounded-full', tier.dot)}>
                LV.{level} {config.label.toUpperCase()}
              </span>
              {gameMode === 'multiplayer' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-black text-white">
                  MULTIPLAYER
                </span>
              )}
              {gameMode === 'multiplayer' && activeRoom && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white">
                  ROUND {activeRoom.roundNumber}/{activeRoom.totalRounds}
                </span>
              )}
              <span className="text-[10px] text-gray-400 font-bold">{level}/{MAX_LEVEL}</span>
            </div>
          </div>
        </div>

        <div className={cn('flex items-center gap-6 p-4 rounded-2xl shadow-sm border', resolvedTheme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-black/5')}>
          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Pieces</span>
            <span className="text-2xl font-mono font-bold text-center">{seatedPiecesCount}/{totalPiecesCount}</span>
          </div>

          <div className={cn('w-px h-10', resolvedTheme === 'dark' ? 'bg-white/10' : 'bg-gray-100')} />

          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Time Left</span>
            <div className="flex items-center gap-2 text-2xl font-mono font-bold">
              <Timer size={20} className={cn(timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-gray-400')} />
              <span>{formatTime(timeLeft)}</span>
            </div>
          </div>

          <div className={cn('w-px h-10', resolvedTheme === 'dark' ? 'bg-white/10' : 'bg-gray-100')} />

          {gameMode === 'multiplayer' ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsScoreboardOpen(true)}
                className={cn('px-3 py-2 rounded-xl border transition-all text-xs font-bold', resolvedTheme === 'dark' ? 'bg-white/10 border-white/10 hover:bg-white/15' : 'bg-white border-black/10 hover:bg-gray-50')}
              >
                Scoreboard
              </button>
              <button
                onClick={handleGiveUpRound}
                disabled={hasSubmittedMatchResult || isWin || isGameOver}
                className="px-3 py-2 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-all text-xs font-bold disabled:opacity-40"
              >
                Give Up
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                if (gameMode === 'arena' && arenaMatch) {
                  const startAtMs = arenaMatch.startAt ? Date.parse(arenaMatch.startAt) : Date.now();
                  const deadlineAt = new Date(startAtMs + arenaMatch.timeoutSeconds * 1000).toISOString();
                  void initGame(arenaMatch.levelId, 'restart', {
                    mode: 'arena',
                    puzzleSeed: arenaMatch.puzzleSeed,
                    startAt: arenaMatch.startAt ?? undefined,
                    deadlineAt,
                    timeoutSeconds: arenaMatch.timeoutSeconds,
                  });
                  return;
                }
                void initGame(undefined, 'restart', { mode: 'single' });
              }}
              className={cn('p-3 rounded-xl transition-all active:scale-95', resolvedTheme === 'dark' ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800')}
              aria-label="Start a new game"
            >
              <RefreshCw size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Main Game Area */}
      <div className="relative w-full max-w-5xl flex flex-col lg:flex-row gap-4 md:gap-8 items-start justify-center">

        {/* Left: Controls */}
        <div className="order-2 lg:order-1 w-full lg:w-48 flex flex-col gap-4">
          <div className={cn('p-6 rounded-3xl shadow-sm border flex flex-col gap-4', resolvedTheme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-black/5')}>
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Piece Controls</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => selectedPieceId && handleRotate(selectedPieceId)}
                disabled={!selectedPieceId}
                className={cn('flex flex-col items-center justify-center p-4 rounded-2xl border transition-all disabled:opacity-30', resolvedTheme === 'dark' ? 'border-white/10 hover:bg-white/10' : 'border-gray-100 hover:bg-gray-50')}
                aria-label="Rotate piece (R)"
              >
                <RotateCw size={20} className="mb-2" />
                <span className="text-[10px] font-bold uppercase">Rotate</span>
                <span className="text-[10px] text-gray-400 mt-1">R</span>
              </button>
              <button
                onClick={() => selectedPieceId && handleFlip(selectedPieceId)}
                disabled={!selectedPieceId}
                className={cn('flex flex-col items-center justify-center p-4 rounded-2xl border transition-all disabled:opacity-30', resolvedTheme === 'dark' ? 'border-white/10 hover:bg-white/10' : 'border-gray-100 hover:bg-gray-50')}
                aria-label="Flip piece (F)"
              >
                <FlipHorizontal size={20} className="mb-2" />
                <span className="text-[10px] font-bold uppercase">Flip</span>
                <span className="text-[10px] text-gray-400 mt-1">F</span>
              </button>
            </div>
            <button
              onClick={() => selectedPieceId && returnToStash(selectedPieceId)}
              disabled={!selectedPieceId}
              className={cn('w-full py-3 rounded-xl border-2 border-dashed transition-all text-xs font-bold uppercase disabled:opacity-30', resolvedTheme === 'dark' ? 'border-white/15 text-gray-400 hover:border-white/30 hover:text-gray-200' : 'border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600')}
              aria-label="Return piece to stash (Esc)"
            >
              Return to Stash
              <span className="ml-2 text-[10px] align-middle">(Esc)</span>
            </button>
            <button
              onClick={resetPiecesToStash}
              disabled={placedPieces.length === 0}
              className={cn(
                'w-full py-3 rounded-xl transition-all text-xs font-bold uppercase disabled:opacity-30',
                resolvedTheme === 'dark' ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800',
              )}
              aria-label="Reset all pieces to stash"
            >
              Reset Pieces
            </button>
          </div>

          <div className={cn('text-white p-6 rounded-3xl shadow-xl', resolvedTheme === 'dark' ? 'bg-white/5 border border-white/10' : 'bg-gray-900')}>
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">How to Play</h3>
            <ul className="text-xs space-y-2 text-gray-300">
              <li className="flex gap-2"><span className="text-emerald-400 font-bold">01</span> Drag pieces to the grid</li>
              <li className="flex gap-2"><span className="text-emerald-400 font-bold">02</span> Select a piece to rotate/flip</li>
              {isMobileViewport && isNewSinglePlayerProfile && (
                <li className="flex gap-2">
                  <span className="text-emerald-400 font-bold">Tip</span>
                  Tap selected piece to rotate, press and hold to flip.
                </li>
              )}
              <li className="flex gap-2"><span className="text-emerald-400 font-bold">03</span> Fill the {gridWidth}x{gridHeight} area ({totalPiecesCount} pieces)</li>
            </ul>
          </div>
        </div>

        {/* Center: Board + Stash unified area */}
        <div className="order-1 lg:order-2 flex-1 w-full flex flex-col items-center">
          {/* Board */}
          <div
            ref={containerRef}
            className={cn('relative z-20 rounded-[40px] shadow-2xl border overflow-visible', resolvedTheme === 'dark' ? 'bg-[#151a25] border-white/10' : 'bg-white border-black/5')}
            style={{
              width: gridWidth * cellSize + gridPadding * 2,
              height: gridHeight * cellSize + gridPadding * 2,
              padding: gridPadding,
            }}
          >
            {/* Grid Background */}
            <div
              className={cn('grid border-2', resolvedTheme === 'dark' ? 'border-white/15 bg-white/3' : 'border-gray-200 bg-gray-50')}
              style={{
                gridTemplateColumns: `repeat(${gridWidth}, ${cellSize}px)`,
                gridTemplateRows: `repeat(${gridHeight}, ${cellSize}px)`,
                width: gridWidth * cellSize,
                height: gridHeight * cellSize,
              }}
            >
              {Array.from({ length: gridWidth * gridHeight }).map((_, i) => {
                const cx = i % gridWidth;
                const cy = Math.floor(i / gridWidth);
                const isBlocked = blockedCellSet.has(`${cx},${cy}`);
                if (isBlocked) {
                  return (
                    <div
                      key={`${cx},${cy}`}
                      className={cn('border', resolvedTheme === 'dark' ? 'border-white/4 bg-black/60' : 'border-gray-300/30 bg-gray-400/30')}
                      style={{ borderRadius: 4 }}
                    />
                  );
                }
                let highlight = '';
                if (draggedPiece) {
                  const piece = placedPieces.find((p) => p.id === draggedPiece.id);
                  if (piece) {
                    const isDraggedCell = piece.currentShape.some(
                      (cell) => piece.position.x + cell.x === cx && piece.position.y + cell.y === cy
                    );
                    if (isDraggedCell && dragValid !== null) highlight = dragValid
                      ? (resolvedTheme === 'dark' ? 'bg-emerald-500/30' : 'bg-emerald-200/60')
                      : (resolvedTheme === 'dark' ? 'bg-red-500/30' : 'bg-red-200/60');
                  }
                }
                return <div key={`${cx},${cy}`} className={cn('border transition-colors duration-75', resolvedTheme === 'dark' ? 'border-white/8' : 'border-gray-200/50', highlight)} />;
              })}
            </div>

            {/* Placed Pieces */}
            {placedPieces.map((piece) => (
              (() => {
                const shapeSize = getShapeSize(piece.currentShape);
                return (
                  <div
                    key={piece.id}
                    className={cn(
                      'absolute z-20 touch-none pointer-events-auto',
                      isWin ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
                      !isWin && selectedPieceId === piece.id && 'z-30',
                    )}
                    style={{
                      left: piece.position.x * cellSize + gridPadding,
                      top: piece.position.y * cellSize + gridPadding,
                      width: shapeSize.width * cellSize,
                      height: shapeSize.height * cellSize,
                    }}
                    onPointerDown={(e) => onPiecePointerDown(e, piece.id, true)}
                  >
                    {piece.currentShape.map((cell, i) => (
                      <div
                        key={i}
                        style={blockCellStyle(
                          piece.color,
                          cellSize,
                          cell.x * cellSize,
                          cell.y * cellSize,
                          draggedPiece?.id === piece.id && dragValid === false ? 0.6 : 1,
                        )}
                      />
                    ))}
                  </div>
                );
              })()
            ))}
          </div>

          {/* Stash — keep slots fixed so other pieces don't jump around across layouts */}
          {stashRenderOrder.length > 0 && (
            <div
              className={cn(
                'relative z-0 mt-2 md:mt-3 w-full rounded-[32px] border shadow-xl px-4 py-3 md:px-6 md:py-4',
                resolvedTheme === 'dark' ? 'bg-white/5 border-white/10' : 'bg-white border-black/5',
              )}
            >
              {/* Fixed-height wrapper so the hint disappearing doesn't shift pieces */}
              <div className="h-6 mb-1 flex items-center justify-center">
                {!isActive && !isGameOver && !isWin && (
                  <p className={cn(
                    'text-center text-[10px] font-bold px-3 py-1 rounded-full animate-pulse',
                    resolvedTheme === 'dark' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700',
                  )}>Click or drag to start!</p>
                )}
              </div>
              <div
                ref={stashScrollRef}
                className="flex flex-wrap items-end justify-center gap-x-4 gap-y-3 px-2 overflow-y-auto overscroll-contain"
                style={{ maxHeight: availableStashPx }}
              >
                {stashRenderOrder.map((pieceId) => {
                  const piece = availableById.get(pieceId);
                  const slotPiece = piece ?? pieceById.get(pieceId);
                  if (!slotPiece) return null;
                  const shapeSize = getShapeSize(slotPiece.shape);
                  const wrapperPadding = Math.max(3, Math.round(stashCellSize * 0.14));
                  const wrapperWidth = shapeSize.width * stashCellSize + wrapperPadding * 2;
                  const wrapperHeight = shapeSize.height * stashCellSize + wrapperPadding * 2;

                  if (!piece) {
                    return (
                      <div
                        key={`stash-${pieceId}`}
                        className="pointer-events-none opacity-0"
                        aria-hidden="true"
                        style={{ width: wrapperWidth, height: wrapperHeight }}
                      />
                    );
                  }

                  return (
                    <div
                      key={`stash-${pieceId}`}
                      className={cn(
                        'relative touch-none',
                        'cursor-grab transition-all hover:scale-[1.03] active:scale-[0.99]',
                      )}
                      style={{ width: wrapperWidth, height: wrapperHeight }}
                      onPointerDown={(e) => onPiecePointerDown(e, piece.id, false)}
                    >
                      {piece.shape.map((cell, i) => (
                        <div
                          key={`${piece.id}-stash-${i}`}
                          style={blockCellStyle(
                            piece.color,
                            stashCellSize,
                            wrapperPadding + cell.x * stashCellSize,
                            wrapperPadding + cell.y * stashCellSize,
                          )}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Overlays */}
      <AnimatePresence>
        {errorMessage && <ErrorModal message={errorMessage} onClose={() => setErrorMessage(null)} />}

        {isGenerating && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 backdrop-blur-sm z-60 flex flex-col items-center justify-center text-center"
          >
            <RefreshCw size={48} className="animate-spin text-black mb-4" />
            <h2 className="text-2xl font-bold tracking-tight">Generating Puzzle...</h2>
            <p className="text-sm text-gray-500 mt-2">Level {level} - {config.label}</p>
          </motion.div>
        )}

        {isShowingSolution && (
          <motion.div
            initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4"
          >
            <div className="bg-white p-6 rounded-4xl shadow-2xl border border-black/5 flex items-center gap-6">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center shrink-0">
                <RefreshCw size={24} />
              </div>
              <div className="flex-1 text-left">
                <h2 className="text-lg font-bold">Solution Shown</h2>
                <p className="text-xs text-gray-500">Ready for a new challenge?</p>
              </div>
              <button
                onClick={() => initGame(undefined, 'restart')}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all text-sm whitespace-nowrap"
              >
                Try Again
              </button>
            </div>
          </motion.div>
        )}

        {isMultiplayerLocked && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/45 backdrop-blur-sm z-55 flex items-center justify-center p-4"
          >
            <div className="bg-white p-10 rounded-[40px] shadow-2xl max-w-sm w-full text-center">
              {isArenaRound ? (
                <>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-red-500 font-bold mb-2">Arena Match</p>
                  <h2 className="text-4xl font-black mb-2">{multiplayerCountdownSeconds}</h2>
                  <p className="text-sm text-gray-500">
                    vs {(() => {
                      const uid = typeof authUser?.id === 'number' ? authUser.id : null;
                      if (!arenaMatch) return '…';
                      if (arenaMatch.player1.id === uid) return arenaMatch.player2.displayName ?? 'Opponent';
                      return arenaMatch.player1.displayName ?? 'Opponent';
                    })()}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Multiplayer Start</p>
                  <h2 className="text-4xl font-black mb-2">{multiplayerCountdownSeconds}</h2>
                  <p className="text-sm text-gray-500">Get ready. Both players start together.</p>
                </>
              )}
            </div>
          </motion.div>
        )}

        {isScoreboardOpen && gameMode === 'multiplayer' && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-[75] flex items-center justify-center p-4"
            onClick={() => setIsScoreboardOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-[36px] shadow-2xl w-full max-w-md p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-black">Tournament Scoreboard</h3>
                <button
                  onClick={() => setIsScoreboardOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-black text-white text-xs font-bold hover:bg-gray-800"
                >
                  Close
                </button>
              </div>

              {activeRoom && (
                <p className="text-xs text-gray-500 mb-3">
                  Round {activeRoom.roundNumber}/{activeRoom.totalRounds}
                </p>
              )}

              <div className="bg-gray-50 border border-black/10 rounded-2xl p-4 mb-4">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Points</p>
                <div className="space-y-2 text-sm">
                  {activeLeaderboard.map((player, idx) => (
                    <div key={player.userId} className="flex items-center justify-between">
                      <span className="font-bold text-gray-700">{idx + 1}. {player.displayName}</span>
                      <span className="font-semibold text-emerald-600">{player.totalPoints} pts</span>
                    </div>
                  ))}
                  {activeLeaderboard.length === 0 && <p className="text-gray-500">No points yet.</p>}
                </div>
              </div>

              <div className="bg-gray-50 border border-black/10 rounded-2xl p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Current Round</p>
                <div className="space-y-2 text-sm">
                  {(() => {
                    const winnerUserId = matchSnapshot?.challenge.winnerUserId ?? activeChallenge?.winnerUserId ?? null;
                    const roundEnded = Boolean(matchSnapshot?.challenge.endedAt);
                    return (matchSnapshot?.players ?? []).map((player) => (
                      <div key={player.userId} className="flex items-center justify-between">
                        <span className="font-bold text-gray-700">{player.displayName}</span>
                        <span className="font-semibold text-gray-500">{formatMultiplayerTimeLabel(player, winnerUserId, roundEnded)}</span>
                      </div>
                    ));
                  })()}
                  {(matchSnapshot?.players ?? []).length === 0 && <p className="text-gray-500">Waiting for submissions...</p>}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}

        {!isShowingSolution && (isGameOver || isWin) && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
              className="bg-white p-12 rounded-[48px] shadow-2xl max-w-md w-full text-center"
            >
              {gameMode === 'arena' ? (
                (() => {
                  const currentUserId = typeof authUser?.id === 'number' ? authUser.id : null;
                  const myResult = currentUserId === null
                    ? null
                    : (arenaMatch?.results.find((r) => r.userId === currentUserId) ?? null);
                  const opponent = (() => {
                    if (!arenaMatch) return null;
                    if (arenaMatch.player1.id === arenaMatch.player2.id) return null;
                    if (currentUserId !== null) {
                      if (arenaMatch.player1.id === currentUserId) return arenaMatch.player2;
                      if (arenaMatch.player2.id === currentUserId) return arenaMatch.player1;
                    }
                    return null;
                  })();
                  const opponentResult = arenaMatch?.results.find((r) => r.userId === opponent?.id) ?? null;
                  const matchFinished = arenaMatch?.status === 'finished' || arenaMatch?.status === 'aborted';
                  const isSubmitting = arenaPhase === 'submitting';
                  const isWaitingOpponent = !isSubmitting && arenaResultSubmitted && !matchFinished;
                  const didWin = currentUserId !== null && matchFinished && arenaMatch?.winnerId === currentUserId;
                  const ratingChange = myResult?.ratingChange ?? null;
                  const ratingAfter = myResult?.ratingAfter ?? null;
                  return (
                    <>
                      {(isSubmitting || isWaitingOpponent) ? (
                        <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6">
                          <div className="w-16 h-16 border-4 border-gray-300 border-t-black rounded-full animate-spin" />
                        </div>
                      ) : (
                        <div className={cn('w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6', didWin ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600')}>
                          {didWin ? <Trophy size={48} /> : <Swords size={48} />}
                        </div>
                      )}
                      <h2 className="text-4xl font-bold mb-1">
                        {isSubmitting ? 'Submitting…' : isWaitingOpponent ? 'Waiting for opponent…' : didWin ? 'Victory!' : 'Defeated'}
                      </h2>
                      <p className="text-gray-500 mb-4">Arena · vs {opponent?.displayName ?? '…'}</p>
                      {matchFinished && ratingChange !== null && ratingAfter !== null && (
                        <div className="flex items-center justify-center gap-2 mb-6">
                          <span className="text-2xl font-bold">{ratingAfter}</span>
                          <span className={cn('text-lg font-semibold', ratingChange >= 0 ? 'text-emerald-600' : 'text-red-500')}>
                            {ratingChange >= 0 ? '+' : ''}{ratingChange}
                          </span>
                        </div>
                      )}
                      {matchFinished && opponentResult && (
                        <div className="bg-gray-50 border border-black/10 rounded-2xl p-4 text-left mb-6 text-sm">
                          <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Match Result</p>
                          {[
                            { label: authUser?.displayName ?? 'You', result: myResult },
                            { label: opponent?.displayName ?? 'Opponent', result: opponentResult },
                          ].map(({ label, result }) => (
                            <div key={label} className="flex justify-between py-1">
                              <span className="font-bold text-gray-700">{label}</span>
                              <span className="text-gray-500">
                                {result?.didFinish && result.elapsedSeconds != null
                                  ? `${result.elapsedSeconds}s`
                                  : 'DNF'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-col gap-3">
                        <button
                          onClick={() => { setArenaMatch(null); setArenaResultSubmitted(false); setArenaPhase('idle'); setScreen('arena'); }}
                          className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all"
                        >
                          Back to Arena
                        </button>
                        <button
                          onClick={() => setScreen('menu')}
                          className="w-full py-3 border-2 border-gray-200 rounded-2xl font-bold text-gray-500 hover:border-gray-400 transition-all text-sm"
                        >
                          Main Menu
                        </button>
                      </div>
                    </>
                  );
                })()
              ) : gameMode === 'multiplayer' ? (
                <>
                  {(() => {
                    const me = (matchSnapshot?.players ?? []).find((player) => player.userId === authUser?.id) ?? null;
                    const myPlacement = me?.placement ?? null;
                    const didFinish = me?.didFinish ?? false;
                    const isRoundWinner = myPlacement === 1;
                    const title = isRoundWinner
                      ? 'You Won!'
                      : (didFinish && myPlacement ? `${toOrdinal(myPlacement)} Place` : 'Match Finished');
                    return (
                      <>
                        <div className={cn('w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6', isRoundWinner ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600')}>
                          {isRoundWinner ? <Trophy size={48} /> : <Timer size={48} />}
                        </div>
                        <h2 className="text-4xl font-bold mb-2">{title}</h2>
                      </>
                    );
                  })()}
                  <p className="text-gray-500 mb-2">
                    {activeChallenge?.isRanked ? 'Ranked challenge' : 'Unranked challenge'} • Code {activeChallenge?.code}
                  </p>
                  {activeRoom && (
                    <p className="text-xs text-gray-400 mb-3">Round {activeRoom.roundNumber}/{activeRoom.totalRounds}</p>
                  )}
                  {!isWin && activeChallenge?.winnerUserId && (
                    <p className="text-sm text-red-500 mb-4">Opponent finished first.</p>
                  )}

                  <div className="bg-gray-50 border border-black/10 rounded-2xl p-4 text-left mb-6">
                    <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Match Times</p>
                    <div className="space-y-2 text-sm">
                      {(() => {
                        const winnerUserId = matchSnapshot?.challenge.winnerUserId ?? activeChallenge?.winnerUserId ?? null;
                        const roundEnded = Boolean(matchSnapshot?.challenge.endedAt);
                        return (matchSnapshot?.players ?? []).map((player) => {
                          const isWinner = winnerUserId !== null && player.userId === winnerUserId;
                          const timeLabel = formatMultiplayerTimeLabel(player, winnerUserId, roundEnded);
                          return (
                            <div key={player.userId} className="flex items-center justify-between">
                              <span className="font-bold text-gray-700">{player.displayName}</span>
                              <span className={cn(
                                'font-semibold',
                                isWinner ? 'text-emerald-600' : (timeLabel === 'In game' ? 'text-blue-600' : 'text-gray-500'),
                              )}>
                                {timeLabel}
                              </span>
                            </div>
                          );
                        });
                      })()}
                      {(matchSnapshot?.players ?? []).length === 0 && (
                        <p className="text-gray-500">Waiting for final scores...</p>
                      )}
                    </div>
                  </div>

                  {activeLeaderboard.length > 0 && (
                    <div className="bg-gray-50 border border-black/10 rounded-2xl p-4 text-left mb-6">
                      <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Tournament Scoreboard</p>
                      <div className="space-y-2 text-sm">
                        {activeLeaderboard.map((player, idx) => (
                          <div key={player.userId} className="flex items-center justify-between">
                            <span className="font-bold text-gray-700">{idx + 1}. {player.displayName}</span>
                            <span className="font-semibold text-emerald-600">{player.totalPoints} pts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {activeRoom && activeRoom.roundNumber < activeRoom.totalRounds && nextRoundReadySubmitted && (
                    <p className="text-xs text-gray-500 mb-3">
                      Waiting for players... Ready {nextRoundReadyCount}/{Math.max(1, activeLeaderboard.length)}
                    </p>
                  )}

                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => setIsScoreboardOpen(true)}
                      className="w-full py-3 border border-black/10 rounded-2xl font-bold text-gray-700 hover:bg-gray-100 transition-all text-sm"
                    >
                      View Scoreboard
                    </button>
                    {activeRoom && activeRoom.roundNumber < activeRoom.totalRounds && (
                      <button
                        onClick={() => { void handleNextMultiplayerRound(); }}
                        disabled={nextRoundReadySubmitted}
                        className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-60"
                      >
                        {nextRoundReadySubmitted ? 'Ready Sent' : 'Next Round'}
                      </button>
                    )}
                    <button
                      onClick={() => setScreen('multiplayer')}
                      className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all"
                    >
                      Back to Multiplayer
                    </button>
                    <button
                      onClick={() => setScreen('menu')}
                      className="w-full py-3 border-2 border-gray-200 rounded-2xl font-bold text-gray-500 hover:border-gray-400 transition-all text-sm"
                    >
                      Main Menu
                    </button>
                  </div>
                </>
              ) : isWin ? (
                <>
                  <div className={cn('w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6', level === MAX_LEVEL ? 'bg-yellow-100 text-yellow-500' : 'bg-emerald-100 text-emerald-600')}>
                    <Trophy size={48} />
                  </div>
                  {level === MAX_LEVEL ? (
                    <>
                      <h2 className="text-4xl font-bold mb-2">All Complete!</h2>
                      <p className="text-gray-500 mb-2">You've mastered all {MAX_LEVEL} levels!</p>
                      <p className="text-sm text-gray-400 mb-8">{formatTime(timeLeft)} remaining on final level.</p>
                    </>
                  ) : (
                    <>
                      {(() => {
                        const displayBest = Math.max(bestTimes[level] ?? 0, timeLeft);
                        const starRating = getLevelStarRating(level, displayBest);
                        return (
                          <div className="flex items-center justify-center gap-1 mb-3" aria-label={`Level rating: ${starRating} stars`}>
                            {[1, 2, 3].map((star) => (
                              <Star
                                key={`result-star-${star}`}
                                size={18}
                                className={star <= starRating ? 'text-yellow-500' : 'text-gray-300'}
                                fill={star <= starRating ? 'currentColor' : 'none'}
                              />
                            ))}
                          </div>
                        );
                      })()}
                      <h2 className="text-4xl font-bold mb-2">Victory!</h2>
                      <p className="text-gray-500 mb-1">Level {level} - {config.label}</p>
                      <p className="text-sm text-gray-400 mb-1">{formatTime(timeLeft)} remaining | Up next: LV.{level + 1} ({getTier(level + 1).name})</p>
                      {bestTimes[level] !== undefined && (
                        <p className="text-xs text-emerald-600 font-bold mb-6">
                          {timeLeft > bestTimes[level] ? 'New Best!' : `Best: ${formatTime(bestTimes[level])} remaining`}
                        </p>
                      )}
                      {bestTimes[level] === undefined && <div className="mb-6" />}
                    </>
                  )}
                  <div className="flex flex-col gap-3">
                    {level < MAX_LEVEL ? (
                      <button
                        onClick={handleNextLevel}
                        className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-2"
                      >
                        Next Level <ChevronRight size={20} />
                      </button>
                    ) : (
                      <button
                        onClick={() => setScreen('levelSelect')}
                        className="w-full py-4 bg-yellow-500 text-white rounded-2xl font-bold hover:bg-yellow-600 transition-all"
                      >
                        Back to Levels
                      </button>
                    )}
                    <button
                      onClick={() => setScreen('levelSelect')}
                      className="w-full py-3 border-2 border-gray-200 rounded-2xl font-bold text-gray-500 hover:border-gray-400 transition-all text-sm"
                    >
                      Level Select
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-24 h-24 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Timer size={48} />
                  </div>
                  <h2 className="text-4xl font-bold mb-2">Time's Up!</h2>
                  <p className="text-gray-500 mb-8">Don't give up. Try again and beat the clock!</p>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={handleShowSolution}
                      disabled={isSolving}
                      className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-50"
                    >
                      {isSolving ? 'Solving...' : 'Show Solution'}
                    </button>
                    <button
                      onClick={() => initGame(undefined, 'restart')}
                      className="w-full py-4 bg-black text-white rounded-2xl font-bold hover:bg-gray-800 transition-all"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={() => setScreen('levelSelect')}
                      className="w-full py-3 border-2 border-gray-200 rounded-2xl font-bold text-gray-500 hover:border-gray-400 transition-all text-sm"
                    >
                      Level Select
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AdBreakModal isOpen={isAdBreakVisible} onContinue={handleAdBreakContinue} />
      <ToastLayer toasts={toasts} />
      {!consent && (
        <ConsentBanner
          onAcceptPersonalized={() => applyConsent(true)}
          onAcceptEssential={() => applyConsent(false)}
        />
      )}

      <div className="mt-auto pt-12 text-gray-400 text-[10px] uppercase tracking-[0.2em] font-bold">
        A Game by TGS LABS
      </div>
    </div>
  );
}
