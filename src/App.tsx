/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RotateCw, FlipHorizontal, RefreshCw, Trophy, Timer, ChevronRight, ChevronLeft, Lock, Users, User, Star, BarChart3, Target, Zap, Medal, Link2, Copy } from 'lucide-react';
import { ALL_PIECES, Piece, Point, rotateShape, flipShape } from './constants';
import { solveKatamino } from './solver';
import { cn } from './lib/utils';
import { trackEvent } from './lib/analytics';
import { configureAdSensePreference, initializeAdSense } from './lib/adsense';
import { fetchCloudProgress, fetchCurrentUser, saveCloudProgress, signInEmail, signInGoogle, signInGuest, signOutCloud, signUpEmail, type CloudUser } from './lib/cloud';
import { mountGoogleLoginButton } from './lib/googleIdentity';
import {
  createMultiplayerChallenge,
  fetchMultiplayerChallenge,
  fetchMultiplayerStats,
  joinMultiplayerChallenge,
  startMultiplayerChallenge,
  submitMultiplayerChallengeResult,
  type MultiplayerChallengeSnapshot,
  type MultiplayerStats,
} from './lib/multiplayer';

const CELL_SIZE = 45;
const GRID_PADDING = 32; // p-8
const CONSENT_KEY = 'pentablocks-consent-v1';
const SESSION_COUNT_KEY = 'pentablocks-session-count';
const AD_BREAK_INTERVAL = 3;
const LOCAL_COMPLETED_KEY = 'katamino-completed';
const LOCAL_BEST_TIMES_KEY = 'katamino-best-times';
const LOCAL_PLAYER_STATS_KEY = 'katamino-player-stats';
const LOCAL_LAST_LEVEL_KEY = 'katamino-last-level';
const DEFAULT_PLAYER_STATS: PlayerStats = {
  gamesStarted: 0,
  wins: 0,
  losses: 0,
  restarts: 0,
  hintsUsed: 0,
  totalPlaySeconds: 0,
};

type Screen = 'menu' | 'levelSelect' | 'game' | 'stats' | 'multiplayer';
type GameMode = 'single' | 'multiplayer';

type LevelFilter = 'all' | 'unlocked' | 'completed';
type ToastTone = 'neutral' | 'success' | 'warning';

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
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
  label: string;
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

interface ConsentState {
  acceptedAt: string;
  personalizedAds: boolean;
}

// ─── 100 Unique Levels ───────────────────────────────────────────────────────
// Every level has a unique (width, height, p4, p3, p2, p1) combination.
// Cell counts verified: p4*4 + p3*3 + p2*2 + p1*1 === width * height.
// Piece pool limits: p4≤7, p3≤2, p2≤1, p1≤1.
const LEVEL_CONFIGS: LevelConfig[] = (() => {
  const TIER_NAMES = ['Spark','Flame','Ember','Blaze','Storm','Thunder','Cyclone','Titan','Legend','Champion'];
  // [w, h, p4, p3, p2, p1, timeSeconds]
  const data: [number,number,number,number,number,number,number][] = [
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
    [7,3, 4,1,1,0, 90],   [7,3, 3,2,1,1, 86],   [4,6, 6,0,0,0, 82],
    [6,4, 6,0,0,0, 80],   [3,8, 6,0,0,0, 78],   [4,6, 5,1,0,1, 76],
    [4,6, 4,2,1,0, 74],   [6,4, 5,1,0,1, 72],   [5,5, 6,0,0,1, 70],
    [5,5, 5,1,1,0, 68],
    // ── Tier 6 — Thunder (51-60): 24-28 cells ──
    [6,4, 4,2,1,0, 80],   [3,8, 5,1,0,1, 76],   [3,8, 4,2,1,0, 73],
    [5,5, 4,2,1,1, 70],   [3,9, 6,1,0,0, 68],   [3,9, 6,0,1,1, 66],
    [3,9, 5,2,0,1, 64],   [4,7, 7,0,0,0, 62],   [4,7, 6,1,0,1, 60],
    [4,7, 5,2,1,0, 58],
    // ── Tier 7 — Cyclone (61-70): 28-32 cells ──
    [7,4, 7,0,0,0, 70],   [7,4, 6,1,0,1, 66],   [7,4, 5,2,1,0, 63],
    [5,6, 7,0,1,0, 60],   [5,6, 6,2,0,0, 57],   [5,6, 6,1,1,1, 55],
    [6,5, 7,0,1,0, 53],   [6,5, 6,2,0,0, 50],   [6,5, 6,1,1,1, 48],
    [4,8, 7,1,0,1, 46],
    // ── Tier 8 — Titan (71-80): 24-35 cells (wide grids) ──
    [4,8, 6,2,1,0, 58],   [8,3, 6,0,0,0, 55],   [8,3, 5,1,0,1, 52],
    [8,3, 4,2,1,0, 50],   [9,3, 6,1,0,0, 48],   [9,3, 6,0,1,1, 46],
    [9,3, 5,2,0,1, 44],   [8,4, 7,1,0,1, 42],   [8,4, 6,2,1,0, 40],
    [5,7, 7,2,0,1, 38],
    // ── Tier 9 — Legend (81-90): 35-36 cells + flat grids ──
    [7,5, 7,2,0,1, 50],   [4,9, 7,2,1,0, 46],   [6,6, 7,2,1,0, 42],
    [9,4, 7,2,1,0, 40],   [6,2, 3,0,0,0, 38],   [6,2, 2,1,0,1, 35],
    [7,2, 3,0,1,0, 33],   [7,2, 2,2,0,0, 30],   [8,2, 4,0,0,0, 28],
    [8,2, 3,1,0,1, 26],
    // ── Tier 10 — Champion (91-100): unique combos + speedruns ──
    [6,2, 1,2,1,0, 35],   [7,2, 2,1,1,1, 32],   [8,2, 2,2,1,0, 30],
    [5,3, 3,0,1,1, 28],   [5,3, 2,2,0,1, 26],   [6,3, 3,1,1,1, 32],
    [2,9, 3,1,1,1, 30],   [3,4, 1,2,1,0, 22],   [4,3, 1,2,1,0, 20],
    [2,6, 1,2,1,0, 18],
  ];

  return data.map(([w, h, p4, p3, p2, p1, t], i) => {
    const tierIdx = Math.floor(i / 10);
    const sub = (i % 10) + 1;
    return { id: i + 1, width: w, height: h, p4, p3, p2, p1, timeSeconds: t, label: `${TIER_NAMES[tierIdx]} ${sub}` };
  });
})();
const MAX_LEVEL = LEVEL_CONFIGS.length; // 100

const TIERS = [
  { name: 'Spark',     range: [1, 10],   bg: 'bg-emerald-50',  border: 'border-emerald-200',  text: 'text-emerald-700',  dot: 'bg-emerald-500' },
  { name: 'Flame',     range: [11, 20],  bg: 'bg-teal-50',     border: 'border-teal-200',     text: 'text-teal-700',     dot: 'bg-teal-500' },
  { name: 'Ember',     range: [21, 30],  bg: 'bg-sky-50',      border: 'border-sky-200',      text: 'text-sky-700',      dot: 'bg-sky-500' },
  { name: 'Blaze',     range: [31, 40],  bg: 'bg-blue-50',     border: 'border-blue-200',     text: 'text-blue-700',     dot: 'bg-blue-500' },
  { name: 'Storm',     range: [41, 50],  bg: 'bg-indigo-50',   border: 'border-indigo-200',   text: 'text-indigo-700',   dot: 'bg-indigo-500' },
  { name: 'Thunder',   range: [51, 60],  bg: 'bg-amber-50',    border: 'border-amber-200',    text: 'text-amber-700',    dot: 'bg-amber-500' },
  { name: 'Cyclone',   range: [61, 70],  bg: 'bg-orange-50',   border: 'border-orange-200',   text: 'text-orange-700',   dot: 'bg-orange-500' },
  { name: 'Titan',     range: [71, 80],  bg: 'bg-rose-50',     border: 'border-rose-200',     text: 'text-rose-700',     dot: 'bg-rose-500' },
  { name: 'Legend',    range: [81, 90],  bg: 'bg-red-50',      border: 'border-red-200',      text: 'text-red-700',      dot: 'bg-red-500' },
  { name: 'Champion',  range: [91, 100], bg: 'bg-purple-50',   border: 'border-purple-200',   text: 'text-purple-700',   dot: 'bg-purple-500' },
];

function getTier(levelId: number) {
  return TIERS[Math.min(Math.floor((levelId - 1) / 10), TIERS.length - 1)];
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

function generateChallengePieces(seed: string, cfg: LevelConfig) {
  const rng = createSeededRng(`${seed}:${cfg.id}`);
  const p4 = ALL_PIECES.filter((p) => p.shape.length === 4);
  const p3 = ALL_PIECES.filter((p) => p.shape.length === 3);
  const p2 = ALL_PIECES.filter((p) => p.shape.length === 2);
  const p1 = ALL_PIECES.filter((p) => p.shape.length === 1);

  const pickCandidates = () => [
    ...shuffleWithRng(p4, rng).slice(0, cfg.p4),
    ...shuffleWithRng(p3, rng).slice(0, cfg.p3),
    ...shuffleWithRng(p2, rng).slice(0, cfg.p2),
    ...shuffleWithRng(p1, rng).slice(0, cfg.p1),
  ];

  for (let attempts = 0; attempts < 220; attempts += 1) {
    const candidate = pickCandidates();
    if (solveKatamino(cfg.width, cfg.height, candidate)) return candidate;
  }

  return pickCandidates();
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

function authErrorToMessage(error: unknown) {
  const code = error instanceof Error ? error.message : 'unknown_error';
  const map: Record<string, string> = {
    network_error: 'Cloud service is temporarily unreachable. Please try again in a few seconds.',
    request_timeout: 'Cloud request timed out. Please try again.',
    auth_bootstrap_timeout: 'Session check took too long. You can sign in manually.',
    invalid_email: 'Please enter a valid email address.',
    password_too_short: 'Password must be at least 8 characters.',
    email_already_registered: 'This email is already registered. Please sign in.',
    invalid_credentials: 'Invalid email or password.',
    google_auth_not_configured: 'Google login is not configured yet.',
    guest_auth_failed: 'Guest sign-in failed. Try again.',
    email_register_failed: 'Email registration failed. Try again.',
    email_login_failed: 'Email sign-in failed. Try again.',
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
    request_failed_500: 'Server error while signing in. Try again.',
    request_failed_503: 'Auth service is not ready yet. Try again.',
  };
  return map[code] ?? code.replaceAll('_', ' ');
}

// ─── Menu Screen ──────────────────────────────────────────────────────────────
function MenuScreen({
  onSinglePlayer,
  onContinue,
  continueLevel,
  onStats,
  onMultiplayer,
}: {
  onSinglePlayer: () => void;
  onContinue?: () => void;
  continueLevel?: number;
  onStats: () => void;
  onMultiplayer: () => void;
}) {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: -40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center mb-16"
      >
        <h1 className="text-8xl font-black tracking-tighter mb-3 select-none">PENTABLOCKS</h1>
        <p className="text-gray-500 uppercase tracking-[0.3em] text-xs font-bold">Tetromino Puzzle Challenge</p>
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
          className="w-full py-5 bg-white text-black rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-gray-100 transition-all active:scale-95"
        >
          <User size={22} /> Single Player
        </button>
        <button
          onClick={onStats}
          className="w-full py-5 bg-emerald-500 text-black rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-emerald-400 transition-all active:scale-95"
        >
          <BarChart3 size={22} /> Stats
        </button>
        <button
          onClick={onMultiplayer}
          className="relative w-full py-5 bg-white/10 text-white rounded-2xl font-bold text-lg flex items-center justify-center gap-3 hover:bg-white/20 transition-all active:scale-95 overflow-hidden border border-white/20"
        >
          <Users size={22} /> Multiplayer
          <span className="absolute top-2 right-3 text-[10px] bg-emerald-400 text-black px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Beta</span>
        </button>
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-20 text-gray-700 text-[10px] uppercase tracking-[0.2em] font-bold"
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
}: {
  completedLevels: Set<number>;
  bestTimes: Record<number, number>;
  onSelectLevel: (level: number) => void;
  onBack: () => void;
  onStats: () => void;
}) {
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
    <div className="min-h-screen bg-[#f5f5f5] p-6 md:p-10">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-4 mb-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-3 bg-black text-white rounded-xl hover:bg-gray-800 transition-all active:scale-95"
              aria-label="Back to menu"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Select Level</h1>
              <p className="text-sm text-gray-500">{completedLevels.size} / {MAX_LEVEL} completed</p>
            </div>
          </div>

          <button
            onClick={onStats}
            className="px-4 py-3 bg-white rounded-xl border border-black/10 hover:bg-gray-50 transition-all active:scale-95 flex items-center gap-2 font-bold text-sm"
          >
            <BarChart3 size={18} /> View Stats
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.5fr_1fr] mb-8">
          <div className="bg-white rounded-3xl p-5 border border-black/5 shadow-sm">
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-3">Tier Navigation</p>
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => setActiveTier((prev) => Math.max(0, prev - 1))}
                disabled={activeTier === 0}
                className="p-2 rounded-xl border border-black/10 bg-white hover:bg-gray-50 disabled:opacity-30"
                aria-label="Previous tier"
              >
                <ChevronLeft size={18} />
              </button>
              <div className={cn('flex-1 rounded-2xl px-4 py-3 border', tier.bg, tier.border)}>
                <p className={cn('text-[10px] uppercase tracking-[0.2em] font-bold mb-1', tier.text)}>
                  Tier {activeTier + 1}
                </p>
                <p className="text-xl font-black">{tier.name}</p>
                <p className="text-sm text-gray-500">Levels {tier.range[0]}-{tier.range[1]}</p>
              </div>
              <button
                onClick={() => setActiveTier((prev) => Math.min(TIERS.length - 1, prev + 1))}
                disabled={activeTier === TIERS.length - 1}
                className="p-2 rounded-xl border border-black/10 bg-white hover:bg-gray-50 disabled:opacity-30"
                aria-label="Next tier"
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
                      ? cn(item.bg, item.border, item.text)
                      : 'bg-white border-black/10 text-gray-500 hover:bg-gray-50'
                  )}
                >
                  {item.name}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-gray-900 text-white rounded-3xl p-5 shadow-xl">
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
            <p className="text-sm text-gray-300">{visibleLevels.length} levels visible in this tier.</p>
            <p className="text-xs text-gray-500 mt-2">Use filters to focus on what is playable now or revisit completed clears.</p>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <div className={cn('w-2 h-2 rounded-full', tier.dot)} />
          <h2 className={cn('text-xs font-bold uppercase tracking-widest', tier.text)}>{tier.name}</h2>
        </div>

        {visibleLevels.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {visibleLevels.map((cfg) => {
              const isCompleted = completedLevels.has(cfg.id);
              const isUnlocked = cfg.id === 1 || completedLevels.has(cfg.id - 1) || isCompleted;
              const subIndex = ((cfg.id - 1) % 10) + 1;
              return (
                <button
                  key={cfg.id}
                  onClick={() => isUnlocked && onSelectLevel(cfg.id)}
                  disabled={!isUnlocked}
                  className={cn(
                    'relative p-4 rounded-2xl border-2 text-left transition-all min-h-28',
                    isUnlocked
                      ? cn(tier.bg, tier.border, 'hover:shadow-md active:scale-95 cursor-pointer')
                      : 'bg-gray-100 border-gray-200 opacity-40 cursor-not-allowed'
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn('text-[10px] font-black', isUnlocked ? tier.text : 'text-gray-400')}>
                      LV {cfg.id}
                    </span>
                    {isCompleted && <Star size={12} className={tier.text} fill="currentColor" />}
                    {!isUnlocked && <Lock size={12} className="text-gray-400" />}
                  </div>
                  <p className="text-lg font-black leading-none mb-2">{subIndex}</p>
                  <p className="text-[11px] text-gray-500">
                    {cfg.width}x{cfg.height} board
                  </p>
                  <p className="text-[11px] text-gray-500">{cfg.timeSeconds}s timer</p>
                  {isCompleted && bestTimes[cfg.id] !== undefined && (
                    <p className={cn('text-[10px] font-bold mt-2', tier.text)}>
                      Best {Math.floor(bestTimes[cfg.id] / 60)}:{String(bestTimes[cfg.id] % 60).padStart(2, '0')}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="bg-white border border-dashed border-black/10 rounded-3xl p-8 text-center text-gray-500">
            No levels match this filter in the current tier.
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
}: {
  completedLevels: Set<number>;
  bestTimes: Record<number, number>;
  playerStats: PlayerStats;
  onBack: () => void;
  onPlay: () => void;
}) {
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

  return (
    <div className="min-h-screen bg-[#f5f5f5] p-6 md:p-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-3 bg-black text-white rounded-xl hover:bg-gray-800 transition-all active:scale-95"
              aria-label="Back"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Player Stats</h1>
              <p className="text-sm text-gray-500">A quick read on progression, pace, and replay habits.</p>
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
          <div className="bg-white rounded-3xl p-5 border border-black/5 shadow-sm">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-3">
              <Target size={20} />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Completion</p>
            <p className="text-3xl font-black">{completionPercent}%</p>
            <p className="text-sm text-gray-500 mt-1">{completedCount} of {MAX_LEVEL} levels cleared</p>
          </div>

          <div className="bg-white rounded-3xl p-5 border border-black/5 shadow-sm">
            <div className="w-10 h-10 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center mb-3">
              <Zap size={20} />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Best Pace</p>
            <p className="text-3xl font-black">{bestTimeValues.length}</p>
            <p className="text-sm text-gray-500 mt-1">Completed levels with saved best times</p>
          </div>

          <div className="bg-white rounded-3xl p-5 border border-black/5 shadow-sm">
            <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mb-3">
              <Medal size={20} />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Win Rate</p>
            <p className="text-3xl font-black">{winRate}%</p>
            <p className="text-sm text-gray-500 mt-1">{playerStats.wins} wins across {playerStats.gamesStarted} starts</p>
          </div>

          <div className="bg-white rounded-3xl p-5 border border-black/5 shadow-sm">
            <div className="w-10 h-10 rounded-2xl bg-rose-100 text-rose-700 flex items-center justify-center mb-3">
              <Timer size={20} />
            </div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Time Played</p>
            <p className="text-3xl font-black">{formatDuration(playerStats.totalPlaySeconds)}</p>
            <p className="text-sm text-gray-500 mt-1">Tracked from active in-level play</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
          <div className="bg-gray-900 text-white rounded-[32px] p-6 shadow-2xl">
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

          <div className="bg-white rounded-[32px] p-6 border border-black/5 shadow-sm">
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-4">Session Details</p>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Games started</span>
                <span className="font-bold">{playerStats.gamesStarted}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Losses</span>
                <span className="font-bold">{playerStats.losses}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Average best time left</span>
                <span className="font-bold">{bestTimeValues.length ? formatDuration(averageBest) : 'No clears yet'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500">Latest unlocked level</span>
                <span className="font-bold">LV {unlockedCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MultiplayerScreen({
  user,
  defaultLevel,
  onBack,
  onStartChallenge,
  onGuestBootstrap,
  multiplayerStats,
  onToast,
}: {
  user: CloudUser | null;
  defaultLevel: number;
  onBack: () => void;
  onStartChallenge: (snapshot: MultiplayerChallengeSnapshot) => Promise<void>;
  onGuestBootstrap: () => Promise<boolean>;
  multiplayerStats: MultiplayerStats | null;
  onToast: (message: string, tone?: ToastTone) => void;
}) {
  const [levelId, setLevelId] = useState(defaultLevel);
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MultiplayerChallengeSnapshot | null>(null);
  const [waitingForOtherReady, setWaitingForOtherReady] = useState(false);
  const launchedChallengeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setLevelId(defaultLevel);
  }, [defaultLevel]);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('challenge');
    if (!code) return;
    setJoinCode(sanitizeCode(code));
  }, []);

  useEffect(() => {
    launchedChallengeKeyRef.current = null;
  }, [snapshot?.challenge.code]);

  const sanitizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

  const shareLink = snapshot
    ? `${window.location.origin}/?challenge=${snapshot.challenge.code}`
    : null;
  const readyTarget = 2;
  const playerCount = snapshot?.players.length ?? 0;
  const readyCount = snapshot?.players.filter((player) => player.status === 'ready' || player.status === 'submitted').length ?? 0;
  const readyPercent = Math.round((Math.min(readyCount, readyTarget) / readyTarget) * 100);
  const readinessLabel = playerCount < readyTarget
    ? `Players ${playerCount}/${readyTarget}`
    : `Ready ${readyCount}/${readyTarget}`;

  const canUseMultiplayer = Boolean(user);

  const launchChallengeIfStarted = useCallback(async (nextSnapshot: MultiplayerChallengeSnapshot) => {
    if (!nextSnapshot.challenge.startAt) return;
    const launchKey = `${nextSnapshot.challenge.code}:${nextSnapshot.challenge.startAt}`;
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
  }, [onStartChallenge]);

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
      const data = await createMultiplayerChallenge(levelId);
      setSnapshot(data);
      setJoinCode(data.challenge.code);
      setWaitingForOtherReady(false);
      onToast(`Challenge ${data.challenge.code} created.`, 'success');
      trackEvent('multiplayer_challenge_created', { level: levelId, code: data.challenge.code });
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
      const data = await joinMultiplayerChallenge(code);
      setSnapshot(data);
      setJoinCode(data.challenge.code);
      setWaitingForOtherReady(false);
      onToast(`Joined challenge ${data.challenge.code}.`, 'success');
      trackEvent('multiplayer_challenge_joined', { code: data.challenge.code });
    } catch (err) {
      setError(authErrorToMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    const code = snapshot?.challenge.code ?? sanitizeCode(joinCode);
    if (!code) return;
    try {
      setLoading(true);
      setError(null);
      const data = await fetchMultiplayerChallenge(code);
      const nextSnapshot = { challenge: data.challenge, players: data.players };
      setSnapshot(nextSnapshot);
      setJoinCode(data.challenge.code);
      await launchChallengeIfStarted(nextSnapshot);
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
      const started = await startMultiplayerChallenge(snapshot.challenge.code);
      setSnapshot(started);
      setJoinCode(started.challenge.code);
      if (started.challenge.startAt) {
        await launchChallengeIfStarted(started);
      } else {
        setWaitingForOtherReady(true);
        onToast('Waiting for the other player to press Play.', 'neutral');
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      if (code === 'challenge_waiting_for_opponent' || code === 'challenge_waiting_for_other_player') {
        setWaitingForOtherReady(true);
        setError(null);
        onToast(authErrorToMessage(err), 'neutral');
      } else {
        setError(authErrorToMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const code = snapshot?.challenge.code;
    if (!code) return;
    let active = true;

    const poll = async () => {
      try {
        const data = await fetchMultiplayerChallenge(code);
        if (!active) return;
        const nextSnapshot = { challenge: data.challenge, players: data.players };
        setSnapshot(nextSnapshot);
        setJoinCode(data.challenge.code);
        if (nextSnapshot.challenge.startAt) {
          await launchChallengeIfStarted(nextSnapshot);
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
    }, waitingForOtherReady ? 900 : 1500);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [launchChallengeIfStarted, snapshot?.challenge.code, waitingForOtherReady]);

  return (
    <div className="min-h-screen bg-[#f5f5f5] p-6 md:p-10">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-3 bg-black text-white rounded-xl hover:bg-gray-800 transition-all active:scale-95"
              aria-label="Back"
            >
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="text-3xl font-black tracking-tight">Multiplayer Beta</h1>
              <p className="text-sm text-gray-500">Create a challenge code or join a friend&apos;s code.</p>
            </div>
          </div>
        </div>

        {!canUseMultiplayer && (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            You can play multiplayer as guest. Guest matches are marked unranked.
            <button
              onClick={() => void onGuestBootstrap()}
              className="ml-2 inline-flex items-center rounded-lg bg-black px-3 py-1.5 text-xs font-bold text-white hover:bg-gray-800"
            >
              Continue as Guest
            </button>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="bg-white rounded-3xl p-6 border border-black/5 shadow-sm">
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-3">Create Challenge</p>
            <label className="text-xs text-gray-500 font-bold uppercase tracking-[0.15em]">Level</label>
            <input
              type="number"
              min={1}
              max={MAX_LEVEL}
              value={levelId}
              onChange={(e) => setLevelId(Math.min(MAX_LEVEL, Math.max(1, Number(e.target.value || 1))))}
              className="mt-2 w-full mb-4 px-3 py-2 rounded-lg border border-black/10 text-sm bg-white"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl bg-black text-white text-sm font-bold hover:bg-gray-800 disabled:opacity-50"
              >
                {loading ? 'Working...' : 'Create Code'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-3xl p-6 border border-black/5 shadow-sm">
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-3">Join Challenge</p>
            <label className="text-xs text-gray-500 font-bold uppercase tracking-[0.15em]">Code</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(sanitizeCode(e.target.value))}
              placeholder="EXAMPLE: A1B2C3D4"
              className="mt-2 w-full mb-4 px-3 py-2 rounded-lg border border-black/10 text-sm bg-white uppercase tracking-wider"
            />
            <button
              onClick={handleJoin}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-emerald-500 text-black text-sm font-bold hover:bg-emerald-400 disabled:opacity-50"
            >
              {loading ? 'Working...' : 'Join Code'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {snapshot && (
          <div className="mt-6 bg-gray-900 text-white rounded-[32px] p-6 shadow-2xl">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500 font-bold mb-1">Active Challenge</p>
                <h2 className="text-2xl font-black flex items-center gap-2">
                  <Link2 size={20} />
                  {snapshot.challenge.code}
                </h2>
                <p className="text-sm text-gray-300 mt-1">
                  Level {snapshot.challenge.levelId} • {snapshot.challenge.status.toUpperCase()} • {snapshot.challenge.isRanked ? 'RANKED' : 'UNRANKED'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRefresh}
                  disabled={loading || launching}
                  className="px-3 py-2 rounded-xl bg-white/10 text-xs font-bold hover:bg-white/20"
                >
                  Refresh
                </button>
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 rounded-xl bg-emerald-400 text-black text-xs font-bold hover:bg-emerald-300 flex items-center gap-1"
                >
                  <Copy size={14} /> Copy Link
                </button>
                <button
                  onClick={() => { void handleReadyAndPlay(); }}
                  disabled={loading || launching}
                  className="px-3 py-2 rounded-xl bg-white text-black text-xs font-bold hover:bg-gray-100 disabled:opacity-60"
                >
                  {loading || launching ? 'Working...' : (waitingForOtherReady ? 'Waiting...' : 'Play Challenge')}
                </button>
              </div>
            </div>

            {waitingForOtherReady && !snapshot.challenge.startAt && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                You are ready. Waiting for the other player to press Play.
              </div>
            )}

            {!snapshot.challenge.startAt && (
              <div className="mb-4 rounded-xl border border-white/15 bg-white/5 px-3 py-3">
                <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.18em] text-gray-300 mb-2">
                  <span>Pre-Match Ready</span>
                  <span>{readinessLabel}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-white/15 overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all duration-300"
                    style={{ width: `${readyPercent}%` }}
                  />
                </div>
              </div>
            )}

            {shareLink && (
              <div className="mb-5 p-3 rounded-xl bg-white/6 text-xs text-gray-300 break-all">
                {shareLink}
              </div>
            )}

            <div className="grid gap-2">
              {snapshot.players.map((player) => (
                <div key={player.userId} className="rounded-2xl bg-white/6 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="font-bold">{player.displayName}</p>
                    <p className="text-xs text-gray-400">
                      {player.provider}
                      {' '}
                      •
                      {' '}
                      {player.status === 'ready' ? 'Ready' : player.status === 'submitted' ? 'Finished' : 'Waiting'}
                    </p>
                  </div>
                  <div className="text-right text-xs text-gray-300">
                    {player.elapsedSeconds !== null ? (
                      <p>Elapsed: {player.elapsedSeconds}s</p>
                    ) : (
                      <p>Waiting result...</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {user && user.provider !== 'guest' && multiplayerStats && (
          <div className="mt-6 bg-white rounded-3xl p-6 border border-black/5 shadow-sm">
            <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-3">Multiplayer Stats</p>
            <div className="grid gap-2 md:grid-cols-4 text-sm">
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-gray-500">Matches</p>
                <p className="text-xl font-black">{multiplayerStats.matchesPlayed}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-gray-500">Wins</p>
                <p className="text-xl font-black">{multiplayerStats.wins}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-gray-500">Losses</p>
                <p className="text-xl font-black">{multiplayerStats.losses}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-gray-500">Best Time</p>
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
  onGuestLogin,
  onEmailLogin,
  onEmailRegister,
  onLogout,
}: {
  user: CloudUser | null;
  authLoading: boolean;
  authError: string | null;
  syncStateLabel: string;
  googleEnabled: boolean;
  googleSlotRef: React.RefObject<HTMLDivElement | null>;
  onGuestLogin: () => Promise<boolean>;
  onEmailLogin: (params: { email: string; password: string }) => void;
  onEmailRegister: (params: { email: string; password: string; displayName: string }) => void;
  onLogout: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [emailMode, setEmailMode] = useState<'signin' | 'register'>('signin');

  const submitEmail = () => {
    const trimmedEmail = email.trim();
    const trimmedName = displayName.trim();
    if (emailMode === 'register') {
      onEmailRegister({
        email: trimmedEmail,
        password,
        displayName: trimmedName || 'Player',
      });
      return;
    }
    onEmailLogin({ email: trimmedEmail, password });
  };

  return (
    <div className="fixed top-4 right-4 z-[82] w-[320px] max-w-[calc(100vw-2rem)]">
      <div className="bg-white border border-black/10 rounded-3xl shadow-xl p-4">
        <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Cloud Profile</p>

        {user ? (
          <>
            <p className="text-sm text-gray-600 mb-1">Signed in as</p>
            <p className="text-base font-black text-black">{user.displayName}</p>
            <p className="text-xs text-gray-500 mb-3">
              {user.provider === 'google' ? 'Google account' : user.provider === 'email' ? 'Email account' : 'Guest cloud account'}
            </p>
            <p className="text-xs text-emerald-700 font-bold mb-3">{syncStateLabel}</p>
            <button
              onClick={onLogout}
              className="w-full py-2.5 rounded-xl border border-black/10 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-all"
            >
              Sign Out
            </button>
          </>
        ) : (
          <>
            {authLoading && (
              <p className="text-xs text-gray-500 mb-2">Checking previous session...</p>
            )}
            <p className="text-sm text-gray-600 mb-3">
              Sign in to keep levels and stats across devices.
            </p>
            <button
              onClick={() => void onGuestLogin()}
              className="w-full py-2.5 rounded-xl bg-black text-white text-sm font-bold hover:bg-gray-800 transition-all mb-2"
            >
              Continue as Guest
            </button>
            <div className="mt-2 border border-black/10 rounded-2xl p-3 bg-gray-50/60">
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => setEmailMode('signin')}
                  className={cn(
                    'flex-1 text-xs font-bold rounded-lg py-1.5',
                    emailMode === 'signin' ? 'bg-black text-white' : 'bg-white text-gray-600 border border-black/10',
                  )}
                >
                  Email Sign In
                </button>
                <button
                  onClick={() => setEmailMode('register')}
                  className={cn(
                    'flex-1 text-xs font-bold rounded-lg py-1.5',
                    emailMode === 'register' ? 'bg-black text-white' : 'bg-white text-gray-600 border border-black/10',
                  )}
                >
                  Create Account
                </button>
              </div>

              {emailMode === 'register' && (
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name"
                  className="w-full mb-2 px-3 py-2 rounded-lg border border-black/10 text-sm bg-white"
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full mb-2 px-3 py-2 rounded-lg border border-black/10 text-sm bg-white"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min 8 chars)"
                className="w-full mb-2 px-3 py-2 rounded-lg border border-black/10 text-sm bg-white"
              />
              <button
                onClick={submitEmail}
                className="w-full py-2 rounded-lg bg-black text-white text-xs font-bold hover:bg-gray-800 transition-all"
              >
                {emailMode === 'register' ? 'Create with Email' : 'Sign In with Email'}
              </button>
            </div>
            {googleEnabled ? (
              <div ref={googleSlotRef} className="w-full min-h-10 flex items-center justify-center mt-2" />
            ) : (
              <p className="text-xs text-gray-500 mt-2">
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
  const [screen, setScreen] = useState<Screen>('menu');
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
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('single');
  const [activeChallenge, setActiveChallenge] = useState<ActiveChallengeState | null>(null);
  const [multiplayerStats, setMultiplayerStats] = useState<MultiplayerStats | null>(null);
  const [multiplayerLockedUntil, setMultiplayerLockedUntil] = useState<number | null>(null);
  const [multiplayerRoundStartMs, setMultiplayerRoundStartMs] = useState<number | null>(null);
  const [matchSnapshot, setMatchSnapshot] = useState<MultiplayerChallengeSnapshot | null>(null);
  const [hasSubmittedMatchResult, setHasSubmittedMatchResult] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; id: string; isFromGrid: boolean; target: HTMLElement } | null>(null);
  const isDraggingRef = useRef(false);
  const dragOffsetRef = useRef<Point>({ x: 0, y: 0 });
  const levelStartRef = useRef<number>(Date.now());
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const cloudSyncTimeoutRef = useRef<number | null>(null);

  const config = LEVEL_CONFIGS[level - 1];
  const gridWidth = config.width;
  const gridHeight = config.height;
  const targetCells = gridWidth * gridHeight;
  const totalPiecesCount = config.p4 + config.p3 + config.p2 + config.p1;
  const isMultiplayerRound = gameMode === 'multiplayer' && activeChallenge !== null;
  const isMultiplayerLocked = isMultiplayerRound && multiplayerLockedUntil !== null && nowTs < multiplayerLockedUntil;
  const multiplayerCountdownSeconds = isMultiplayerLocked && multiplayerLockedUntil !== null
    ? Math.max(0, Math.ceil((multiplayerLockedUntil - nowTs) / 1000))
    : 0;

  // Count only pieces fully inside the grid with no overlap
  const seatedPiecesCount = (() => {
    const occupied = new Set<string>();
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
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

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

  const submitChallengeResult = useCallback(async (didWin: boolean, remainingOverride?: number) => {
    if (!activeChallenge || hasSubmittedMatchResult) return null;
    const elapsedSeconds = Math.max(0, Math.round((Date.now() - levelStartRef.current) / 1000));
    const remainingSeconds = Math.max(0, Math.floor(remainingOverride ?? timeLeft));
    try {
      const snapshot = await submitMultiplayerChallengeResult(activeChallenge.code, {
        didWin,
        elapsedSeconds,
        remainingSeconds,
      });
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
  }, [activeChallenge, authUser, hasSubmittedMatchResult, timeLeft]);

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
  }) => {
    const normalizedLastLevel = Math.min(MAX_LEVEL, Math.max(1, payload.lastLevel));
    const nextCompleted = new Set<number>(payload.completedLevels);
    setCompletedLevels(nextCompleted);
    setBestTimes(payload.bestTimes);
    setPlayerStats(payload.playerStats);
    setSinglePlayerLevel(normalizedLastLevel);
    if (gameMode !== 'multiplayer') {
      setLevel(normalizedLastLevel);
    }
  }, [gameMode]);

  const clearLegacyLocalProgress = useCallback(() => {
    localStorage.removeItem(LOCAL_COMPLETED_KEY);
    localStorage.removeItem(LOCAL_BEST_TIMES_KEY);
    localStorage.removeItem(LOCAL_PLAYER_STATS_KEY);
    localStorage.removeItem(LOCAL_LAST_LEVEL_KEY);
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
    };
    // Account progress must be isolated per user. Do not auto-merge local device data.
    applyMergedProgress(isolated);
    setCloudReady(true);
  }, [applyMergedProgress]);

  const handleGuestLogin = useCallback(async () => {
    try {
      setAuthError(null);
      setAuthLoading(true);
      const user = await signInGuest();
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

  const handleEmailRegister = useCallback(async (params: { email: string; password: string; displayName: string }) => {
    try {
      setAuthError(null);
      setAuthLoading(true);
      const user = await signUpEmail(params);
      setAuthUser(user);
      await hydrateCloudForUser();
      showToast('Email account created and synced.', 'success');
      trackEvent('auth_login', { provider: 'email_register' });
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }, [hydrateCloudForUser, showToast]);

  const handleEmailLogin = useCallback(async (params: { email: string; password: string }) => {
    try {
      setAuthError(null);
      setAuthLoading(true);
      const user = await signInEmail(params);
      setAuthUser(user);
      await hydrateCloudForUser();
      showToast('Email account connected.', 'success');
      trackEvent('auth_login', { provider: 'email' });
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
      setGameMode('single');
      setMatchSnapshot(null);
      setHasSubmittedMatchResult(false);
      setMultiplayerLockedUntil(null);
      resetProgressToDefaults();
      clearLegacyLocalProgress();
      showToast('Signed out. Progress reset to Level 1 on this device.', 'neutral');
      trackEvent('auth_logout');
    } catch (error) {
      setAuthError(authErrorToMessage(error));
    }
  }, [clearLegacyLocalProgress, resetProgressToDefaults, showToast]);

  useEffect(() => {
    const rawCount = Number(localStorage.getItem(SESSION_COUNT_KEY) ?? '0');
    const safeCount = Number.isFinite(rawCount) && rawCount >= 0 ? rawCount : 0;
    const nextCount = safeCount + 1;
    localStorage.setItem(SESSION_COUNT_KEY, String(nextCount));
    setIsFirstSession(safeCount === 0);
    trackEvent('session_start', { session_number: nextCount, first_session: safeCount === 0 });
  }, []);

  useEffect(() => {
    const challengeCode = new URLSearchParams(window.location.search).get('challenge');
    if (!challengeCode) return;
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
  }, [authUser, handleGoogleCredential, googleEnabled]);

  useEffect(() => {
    trackEvent('screen_view', { screen });
  }, [screen]);

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

  useEffect(() => {
    if (!consent) return;
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    configureAdSensePreference(consent.personalizedAds);
    if (initializeAdSense(consent.personalizedAds)) {
      trackEvent('adsense_initialized', {
        personalized_ads: consent.personalizedAds,
      });
    }
  }, [consent]);

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
  }, [authUser, cloudReady, completedLevels, bestTimes, playerStats, singlePlayerLevel, gameMode]);

  useEffect(() => {
    if (!isMultiplayerRound || !activeChallenge || !authUser) return;
    let active = true;
    const poll = async () => {
      try {
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

        const winnerId = latest.challenge.winnerUserId;
        if (winnerId && winnerId !== authUser.id && !isWin && !isGameOver) {
          setIsActive(false);
          setIsGameOver(true);
          showToast('Opponent finished first.', 'warning');
          if (!hasSubmittedMatchResult) {
            void submitChallengeResult(false);
          }
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
  }, [isMultiplayerRound, activeChallenge, authUser, isWin, isGameOver, hasSubmittedMatchResult, submitChallengeResult, showToast]);

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

    const tempOccupied = new Set<string>();
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
  }, [draggedPiece, placedPieces, gridWidth, gridHeight]);

  const initGame = useCallback(async (
    targetLevel?: number,
    reason: 'start' | 'restart' | 'next' = 'start',
    options?: { mode?: GameMode; puzzleSeed?: string; startAt?: string | null },
  ) => {
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
    setSelectedPieceId(null);
    const startAtMsRaw = options?.startAt ? Date.parse(options.startAt) : NaN;
    const hasStartAt = Number.isFinite(startAtMsRaw);
    const effectiveStartMs = hasStartAt ? startAtMsRaw : Date.now();
    const elapsedFromStart = Math.max(0, Math.floor((Date.now() - effectiveStartMs) / 1000));
    const initialTimeLeft = mode === 'multiplayer'
      ? Math.max(0, cfg.timeSeconds - elapsedFromStart)
      : cfg.timeSeconds;
    setTimeLeft(initialTimeLeft);
    levelStartRef.current = effectiveStartMs;
    if (mode === 'single' && reason !== 'next') {
      setAdBreakLevel(null);
      setQueuedNextLevel(null);
      setIsAdBreakVisible(false);
    }
    if (mode === 'multiplayer') {
      setMultiplayerRoundStartMs(effectiveStartMs);
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
    }

    trackEvent('level_start', {
      level: levelToSet,
      reason,
      board: `${cfg.width}x${cfg.height}`,
      time_limit: cfg.timeSeconds,
      mode,
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    let solvablePieces: Piece[] = [];
    if (mode === 'multiplayer' && options?.puzzleSeed) {
      solvablePieces = generateChallengePieces(options.puzzleSeed, cfg);
    } else {
      let attempts = 0;
      const maxAttempts = 100;

      const p4 = ALL_PIECES.filter(p => p.shape.length === 4);
      const p3 = ALL_PIECES.filter(p => p.shape.length === 3);
      const p2 = ALL_PIECES.filter(p => p.shape.length === 2);
      const p1 = ALL_PIECES.filter(p => p.shape.length === 1);

      const currentWidth = cfg.width;
      const currentHeight = cfg.height;

      const pickCandidates = () => [
        ...[...p4].sort(() => Math.random() - 0.5).slice(0, cfg.p4),
        ...[...p3].sort(() => Math.random() - 0.5).slice(0, cfg.p3),
        ...[...p2].sort(() => Math.random() - 0.5).slice(0, cfg.p2),
        ...[...p1].sort(() => Math.random() - 0.5).slice(0, cfg.p1),
      ];

      while (attempts < maxAttempts) {
        const candidatePieces = pickCandidates();
        const solution = solveKatamino(currentWidth, currentHeight, candidatePieces);
        if (solution) {
          solvablePieces = candidatePieces;
          break;
        }
        attempts++;
      }

      if (solvablePieces.length === 0) {
        let fallback: Piece[] | null = null;
        for (let i = 0; i < 200 && !fallback; i++) {
          const cands = pickCandidates();
          if (solveKatamino(currentWidth, currentHeight, cands)) fallback = cands;
        }
        solvablePieces = fallback ?? pickCandidates();
      }
    }

    setAvailablePieces(solvablePieces);
    setIsGenerating(false);
  }, [level, updatePlayerStats]);

  useEffect(() => {
    if (!isMultiplayerRound || multiplayerLockedUntil === null) return;
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
  }, [isMultiplayerRound, multiplayerLockedUntil, timeLeft]);

  useEffect(() => {
    if (!isMultiplayerLocked) return;
    const interval = window.setInterval(() => {
      setNowTs(Date.now());
    }, 250);
    return () => {
      window.clearInterval(interval);
    };
  }, [isMultiplayerLocked]);

  // Multiplayer timer uses absolute start time to avoid drift/freezes.
  useEffect(() => {
    if (!isMultiplayerRound || multiplayerRoundStartMs === null) return;
    if (isWin || isGameOver || isShowingSolution || isSolving || isGenerating) return;
    let didTimeout = false;

    const syncRemaining = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - multiplayerRoundStartMs) / 1000));
      const remaining = Math.max(0, config.timeSeconds - elapsed);
      setTimeLeft((prev) => (prev === remaining ? prev : remaining));

      if (isMultiplayerLocked) return;
      if (remaining <= 0 && !didTimeout) {
        didTimeout = true;
        setIsGameOver(true);
        setIsActive(false);
        void submitChallengeResult(false, 0);
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
      const occupied = new Set<string>();
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

      if (allInBounds && !overlap && occupied.size === targetCells) {
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
            const shouldShowAdBreak = !isFirstSession && next % AD_BREAK_INTERVAL === 0;
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
  }, [placedPieces, isShowingSolution, isGameOver, totalPiecesCount, gridWidth, gridHeight, targetCells, level, timeLeft, markLevelComplete, saveBestTime, updatePlayerStats, showToast, completedLevels, bestTimes, isFirstSession, gameMode, submitChallengeResult]);

  const handleRotate = useCallback((id: string) => {
    setPlacedPieces((prev) => {
      if (!prev.some(p => p.id === id)) return prev;
      return prev.map((p) => p.id === id ? { ...p, currentShape: rotateShape(p.currentShape), rotation: (p.rotation + 90) % 360 } : p);
    });
    setAvailablePieces((prev) => {
      if (!prev.some(p => p.id === id)) return prev;
      return prev.map((p) => p.id === id ? { ...p, shape: rotateShape(p.shape) } : p);
    });
  }, []);

  const handleFlip = useCallback((id: string) => {
    setPlacedPieces((prev) => {
      if (!prev.some(p => p.id === id)) return prev;
      return prev.map((p) => p.id === id ? { ...p, currentShape: flipShape(p.currentShape), isFlipped: !p.isFlipped } : p);
    });
    setAvailablePieces((prev) => {
      if (!prev.some(p => p.id === id)) return prev;
      return prev.map((p) => p.id === id ? { ...p, shape: flipShape(p.shape) } : p);
    });
  }, []);

  const returnToStash = useCallback((id: string) => {
    const piece = placedPieces.find((p) => p.id === id);
    if (!piece) return;

    // Keep updaters pure. In StrictMode, impure updaters can run twice and duplicate stash entries.
    setPlacedPieces((prev) => prev.filter((p) => p.id !== id));
    setAvailablePieces((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      return [...prev, { id: piece.id, name: piece.name, shape: piece.shape, color: piece.color }];
    });
  }, [placedPieces]);

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
    const x = clientX - containerRect.left - GRID_PADDING - dragOffsetRef.current.x;
    const y = clientY - containerRect.top - GRID_PADDING - dragOffsetRef.current.y;
    return { x: Math.round(x / CELL_SIZE), y: Math.round(y / CELL_SIZE) };
  };

  const handlePointerDown = (clientX: number, clientY: number, id: string, isFromGrid: boolean, target: HTMLElement) => {
    if (isGameOver || isWin) return;
    if (isMultiplayerLocked) {
      showToast('Match will start together after countdown.', 'neutral');
      return;
    }
    if (!isActive) setIsActive(true);
    setSelectedPieceId(id);

    // Immediately start drag
    const rect = target.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    dragOffsetRef.current = { x: offsetX, y: offsetY };
    dragStartRef.current = { x: clientX, y: clientY, id, isFromGrid, target };
    isDraggingRef.current = true;
    setDraggedPiece({ id, offset: { x: offsetX, y: offsetY } });

    if (!isFromGrid) {
      const p = availablePieces.find((piece) => piece.id === id);
      if (!p) return;
      const containerRect = containerRef.current?.getBoundingClientRect();
      const initX = containerRect ? Math.round((clientX - containerRect.left - GRID_PADDING - offsetX) / CELL_SIZE) : 0;
      const initY = containerRect ? Math.round((clientY - containerRect.top - GRID_PADDING - offsetY) / CELL_SIZE) : 0;
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

  const handlePointerMove = (clientX: number, clientY: number) => {
    if (!isDraggingRef.current || !containerRef.current || !dragStartRef.current) return;
    const { x: gridX, y: gridY } = screenToGrid(clientX, clientY);
    const dragId = dragStartRef.current.id;
    setPlacedPieces((prev) =>
      prev.map((p) => p.id === dragId ? { ...p, position: { x: gridX, y: gridY } } : p)
    );
  };

  const handlePointerUp = useCallback(() => {
    if (isDraggingRef.current) {
      setDraggedPiece(null);
    }
    dragStartRef.current = null;
    isDraggingRef.current = false;
  }, []);

  // Release drag if mouse leaves window
  useEffect(() => {
    window.addEventListener('mouseup', handlePointerUp);
    return () => window.removeEventListener('mouseup', handlePointerUp);
  }, [handlePointerUp]);

  const onMouseDown = (e: React.MouseEvent, id: string, isFromGrid: boolean) => {
    e.preventDefault(); // Prevent native drag (🚫 cursor)
    handlePointerDown(e.clientX, e.clientY, id, isFromGrid, e.currentTarget as HTMLElement);
  };
  const onMouseMove = (e: React.MouseEvent) => handlePointerMove(e.clientX, e.clientY);
  const onMouseUp = handlePointerUp;

  const onTouchStart = (e: React.TouchEvent, id: string, isFromGrid: boolean) => {
    e.preventDefault();
    const touch = e.touches[0];
    handlePointerDown(touch.clientX, touch.clientY, id, isFromGrid, e.currentTarget as HTMLElement);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    handlePointerMove(touch.clientX, touch.clientY);
  };
  const onTouchEnd = handlePointerUp;

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
      const solution = solveKatamino(gridWidth, gridHeight, allPieces);
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
    setGameMode('single');
    setMatchSnapshot(null);
    setHasSubmittedMatchResult(false);
    initGame(lvl, 'start', { mode: 'single' });
    setScreen('game');
  }, [initGame]);

  const continueFromLastLevel = useCallback(() => {
    setActiveChallenge(null);
    setGameMode('single');
    setMatchSnapshot(null);
    setHasSubmittedMatchResult(false);
    initGame(singlePlayerLevel, 'start', { mode: 'single' });
    setScreen('game');
  }, [initGame, singlePlayerLevel]);

  const startChallengeGame = useCallback(async (snapshot: MultiplayerChallengeSnapshot) => {
    const challengeState: ActiveChallengeState = {
      code: snapshot.challenge.code,
      levelId: snapshot.challenge.levelId,
      puzzleSeed: snapshot.challenge.puzzleSeed,
      isRanked: snapshot.challenge.isRanked,
      startAt: snapshot.challenge.startAt,
      winnerUserId: snapshot.challenge.winnerUserId,
    };
    setActiveChallenge(challengeState);
    setMatchSnapshot(null);
    setHasSubmittedMatchResult(false);
    await initGame(snapshot.challenge.levelId, 'start', {
      mode: 'multiplayer',
      puzzleSeed: snapshot.challenge.puzzleSeed,
      startAt: snapshot.challenge.startAt,
    });
    setScreen('game');
    if (snapshot.challenge.startAt) {
      const msLeft = Date.parse(snapshot.challenge.startAt) - Date.now();
      if (msLeft > 0) {
        showToast(`Match starts in ${Math.ceil(msLeft / 1000)}s`, 'neutral');
      }
    }
  }, [initGame, showToast]);

  // ── Screen routing ──
  if (screen === 'menu') {
    return (
      <>
        <MenuScreen
          onContinue={continueFromLastLevel}
          continueLevel={singlePlayerLevel}
          onSinglePlayer={() => setScreen('levelSelect')}
          onStats={() => setScreen('stats')}
          onMultiplayer={() => setScreen('multiplayer')}
        />
        <AccountPanel
          user={authUser}
          authLoading={authLoading}
          authError={authError}
          syncStateLabel={cloudSyncing ? 'Syncing to cloud...' : 'Cloud sync ready'}
          googleEnabled={googleEnabled}
          googleSlotRef={googleButtonRef}
          onGuestLogin={handleGuestLogin}
          onEmailLogin={handleEmailLogin}
          onEmailRegister={handleEmailRegister}
          onLogout={handleLogout}
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
          defaultLevel={singlePlayerLevel}
          onBack={() => setScreen('menu')}
          onStartChallenge={startChallengeGame}
          onGuestBootstrap={handleGuestLogin}
          multiplayerStats={multiplayerStats}
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

  if (screen === 'levelSelect') {
    return (
      <>
        <LevelSelectScreen
          completedLevels={completedLevels}
          bestTimes={bestTimes}
          onSelectLevel={startLevel}
          onBack={() => setScreen('menu')}
          onStats={() => setScreen('stats')}
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

  return (
    <div
      className="min-h-screen bg-[#f5f5f5] text-[#1a1a1a] font-sans p-4 md:p-8 flex flex-col items-center select-none"
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Header */}
      <div className="w-full max-w-4xl flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={goToLevelSelect}
            className="p-3 bg-white border border-black/10 rounded-xl hover:bg-gray-100 transition-all active:scale-95"
            aria-label={gameMode === 'multiplayer' ? 'Back to multiplayer' : 'Back to level select'}
          >
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="text-4xl font-bold tracking-tight mb-1">PENTABLOCKS</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn('text-white text-[10px] font-bold px-2 py-0.5 rounded-full', tier.dot)}>
                LV.{level} {config.label.toUpperCase()}
              </span>
              {gameMode === 'multiplayer' && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-black text-white">
                  MULTIPLAYER
                </span>
              )}
              <span className="text-[10px] text-gray-400 font-bold">{level}/{MAX_LEVEL}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6 bg-white p-4 rounded-2xl shadow-sm border border-black/5">
          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Pieces</span>
            <span className="text-2xl font-mono font-bold text-center">{seatedPiecesCount}/{totalPiecesCount}</span>
          </div>

          <div className="w-px h-10 bg-gray-100" />

          <div className="flex flex-col items-center">
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1">Time Left</span>
            <div className="flex items-center gap-2 text-2xl font-mono font-bold">
              <Timer size={20} className={cn(timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-gray-400')} />
              <span>{formatTime(timeLeft)}</span>
            </div>
          </div>

          <div className="w-px h-10 bg-gray-100" />

          <button
            onClick={() => {
              if (gameMode === 'multiplayer') {
                showToast('Restart is disabled in multiplayer races.', 'warning');
                return;
              }
              void initGame(undefined, 'restart', { mode: 'single' });
            }}
            className="p-3 bg-black text-white rounded-xl hover:bg-gray-800 transition-all active:scale-95 disabled:opacity-40"
            aria-label="Start a new game"
            disabled={gameMode === 'multiplayer'}
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="relative w-full max-w-5xl flex flex-col lg:flex-row gap-8 items-start justify-center">

        {/* Left: Controls */}
        <div className="w-full lg:w-48 flex flex-col gap-4">
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-black/5 flex flex-col gap-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Piece Controls</h3>
            <p className="text-[10px] text-gray-400">R = Rotate | F = Flip | Esc = Stash</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => selectedPieceId && handleRotate(selectedPieceId)}
                disabled={!selectedPieceId}
                className="flex flex-col items-center justify-center p-4 rounded-2xl border border-gray-100 hover:bg-gray-50 transition-all disabled:opacity-30"
                aria-label="Rotate piece (R)"
              >
                <RotateCw size={20} className="mb-2" />
                <span className="text-[10px] font-bold uppercase">Rotate</span>
              </button>
              <button
                onClick={() => selectedPieceId && handleFlip(selectedPieceId)}
                disabled={!selectedPieceId}
                className="flex flex-col items-center justify-center p-4 rounded-2xl border border-gray-100 hover:bg-gray-50 transition-all disabled:opacity-30"
                aria-label="Flip piece (F)"
              >
                <FlipHorizontal size={20} className="mb-2" />
                <span className="text-[10px] font-bold uppercase">Flip</span>
              </button>
            </div>
            <button
              onClick={() => selectedPieceId && returnToStash(selectedPieceId)}
              disabled={!selectedPieceId}
              className="w-full py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-600 transition-all text-xs font-bold uppercase disabled:opacity-30"
              aria-label="Return piece to stash (Esc)"
            >
              Return to Stash
            </button>
          </div>

          <div className="bg-gray-900 text-white p-6 rounded-3xl shadow-xl">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">How to Play</h3>
            <ul className="text-xs space-y-2 text-gray-300">
              <li className="flex gap-2"><span className="text-emerald-400 font-bold">01</span> Drag pieces to the grid</li>
              <li className="flex gap-2"><span className="text-emerald-400 font-bold">02</span> Select a piece to rotate/flip</li>
              <li className="flex gap-2"><span className="text-emerald-400 font-bold">03</span> Fill the {gridWidth}x{gridHeight} area ({totalPiecesCount} pieces)</li>
            </ul>
          </div>
        </div>

        {/* Center: Board + Stash unified area */}
        <div className="flex-1 flex flex-col items-center">
          {/* Board */}
          <div
            ref={containerRef}
            className="relative bg-white p-8 rounded-[40px] shadow-2xl border border-black/5 overflow-visible"
            style={{ width: gridWidth * CELL_SIZE + 64, height: gridHeight * CELL_SIZE + 64 }}
          >
            {/* Grid Background */}
            <div
              className="grid border-2 border-gray-200 bg-gray-50"
              style={{
                gridTemplateColumns: `repeat(${gridWidth}, ${CELL_SIZE}px)`,
                gridTemplateRows: `repeat(${gridHeight}, ${CELL_SIZE}px)`,
                width: gridWidth * CELL_SIZE,
                height: gridHeight * CELL_SIZE,
              }}
            >
              {Array.from({ length: targetCells }).map((_, i) => {
                const cx = i % gridWidth;
                const cy = Math.floor(i / gridWidth);
                let highlight = '';
                if (draggedPiece) {
                  const piece = placedPieces.find((p) => p.id === draggedPiece.id);
                  if (piece) {
                    const isDraggedCell = piece.currentShape.some(
                      (cell) => piece.position.x + cell.x === cx && piece.position.y + cell.y === cy
                    );
                    if (isDraggedCell && dragValid !== null) highlight = dragValid ? 'bg-emerald-200/60' : 'bg-red-200/60';
                  }
                }
                return <div key={`${cx},${cy}`} className={cn('border border-gray-200/50 transition-colors duration-75', highlight)} />;
              })}
            </div>

            {/* Placed Pieces */}
            {placedPieces.map((piece) => (
              <div
                key={piece.id}
                className={cn(
                  'absolute transition-shadow touch-none',
                  isWin ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
                  !isWin && selectedPieceId === piece.id && 'z-10 ring-2 ring-black ring-offset-4 rounded-sm'
                )}
                style={{ left: piece.position.x * CELL_SIZE + GRID_PADDING, top: piece.position.y * CELL_SIZE + GRID_PADDING, width: 0, height: 0 }}
                onMouseDown={(e) => onMouseDown(e, piece.id, true)}
                onTouchStart={(e) => onTouchStart(e, piece.id, true)}
              >
                {piece.currentShape.map((cell, i) => (
                  <div
                    key={i}
                    className="absolute border border-black/10 shadow-inner"
                    style={{
                      left: cell.x * CELL_SIZE,
                      top: cell.y * CELL_SIZE,
                      width: CELL_SIZE,
                      height: CELL_SIZE,
                      backgroundColor: piece.color,
                      borderRadius: '4px',
                      opacity: draggedPiece?.id === piece.id && dragValid === false ? 0.6 : 1,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Stash — pieces outside the board */}
          {availablePieces.length > 0 && (
            <div className="mt-6 w-full">
              {!isActive && !isGameOver && !isWin && (
                <p className="text-center text-[10px] bg-emerald-100 text-emerald-700 font-bold px-3 py-1 rounded-full animate-pulse mb-4 mx-auto w-fit">Click or drag to start!</p>
              )}
              <div className="flex flex-wrap justify-center gap-6 px-4">
                {availablePieces.map((piece) => (
                  <div
                    key={piece.id}
                    className={cn(
                      'relative cursor-grab hover:scale-105 transition-all touch-none rounded-lg',
                      selectedPieceId === piece.id && 'ring-2 ring-black ring-offset-4 scale-105'
                    )}
                    style={{
                      width: Math.max(...piece.shape.map((p) => p.x)) * CELL_SIZE + CELL_SIZE,
                      height: Math.max(...piece.shape.map((p) => p.y)) * CELL_SIZE + CELL_SIZE,
                    }}
                    onMouseDown={(e) => onMouseDown(e, piece.id, false)}
                    onTouchStart={(e) => onTouchStart(e, piece.id, false)}
                  >
                    {piece.shape.map((cell, i) => (
                      <div
                        key={i}
                        className="absolute border border-black/10 shadow-sm"
                        style={{
                          left: cell.x * CELL_SIZE,
                          top: cell.y * CELL_SIZE,
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          backgroundColor: piece.color,
                          borderRadius: '4px',
                        }}
                      />
                    ))}
                  </div>
                ))}
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
              <p className="text-[10px] uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Multiplayer Start</p>
              <h2 className="text-4xl font-black mb-2">{multiplayerCountdownSeconds}</h2>
              <p className="text-sm text-gray-500">Get ready. Both players start together.</p>
            </div>
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
              {gameMode === 'multiplayer' ? (
                <>
                  <div className={cn('w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6', isWin ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600')}>
                    {isWin ? <Trophy size={48} /> : <Timer size={48} />}
                  </div>
                  <h2 className="text-4xl font-bold mb-2">{isWin ? 'You Won!' : 'Match Finished'}</h2>
                  <p className="text-gray-500 mb-2">
                    {activeChallenge?.isRanked ? 'Ranked challenge' : 'Unranked challenge'} • Code {activeChallenge?.code}
                  </p>
                  {!isWin && activeChallenge?.winnerUserId && (
                    <p className="text-sm text-red-500 mb-4">Opponent finished first.</p>
                  )}

                  <div className="bg-gray-50 border border-black/10 rounded-2xl p-4 text-left mb-6">
                    <p className="text-xs uppercase tracking-[0.2em] text-gray-400 font-bold mb-2">Match Times</p>
                    <div className="space-y-2 text-sm">
                      {(() => {
                        const winnerUserId = matchSnapshot?.challenge.winnerUserId ?? activeChallenge?.winnerUserId ?? null;
                        return (matchSnapshot?.players ?? []).map((player) => {
                          const isWinner = winnerUserId !== null && player.userId === winnerUserId;
                          return (
                            <div key={player.userId} className="flex items-center justify-between">
                              <span className="font-bold text-gray-700">{player.displayName}</span>
                              <span className={cn('font-semibold', isWinner ? 'text-emerald-600' : 'text-gray-500')}>
                                {winnerUserId !== null
                                  ? (isWinner
                                    ? `Won ${player.elapsedSeconds !== null ? `${player.elapsedSeconds}s` : ''}`.trim()
                                    : 'DNF')
                                  : (player.elapsedSeconds !== null ? `${player.elapsedSeconds}s` : 'No finish')}
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

                  <div className="flex flex-col gap-3">
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
