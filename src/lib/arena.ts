const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE = configuredApiBase
  ? configuredApiBase.replace(/\/+$/, '')
  : (import.meta.env.DEV ? 'http://localhost:8787' : '');

function buildApiUrl(path: string) {
  if (!API_BASE) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const apiBaseEndsWithApi = /\/api$/i.test(API_BASE);
  const pathStartsWithApi = /^\/api(\/|$)/i.test(normalizedPath);
  if (apiBaseEndsWithApi && pathStartsWithApi) {
    return `${API_BASE}${normalizedPath.replace(/^\/api/i, '') || '/'}`;
  }
  return `${API_BASE}${normalizedPath}`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(buildApiUrl(path), {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `request_failed_${res.status}`;
    try {
      const payload = await res.json() as { error?: string };
      if (payload?.error) message = payload.error;
    } catch { /* no-op */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ArenaProfile {
  rating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
}

export interface ArenaMatchPlayer {
  id: number;
  displayName: string | null;
  rating: number;
}

export interface ArenaMatchResult {
  userId: number;
  didFinish: boolean;
  elapsedSeconds: number | null;
  remainingSeconds: number | null;
  ratingBefore: number;
  ratingAfter: number;
  ratingChange: number;
  submittedAt: string | null;
}

export interface ArenaMatch {
  code: string;
  levelId: number;
  puzzleSeed: string;
  player1: ArenaMatchPlayer;
  player2: ArenaMatchPlayer;
  status: 'pending' | 'active' | 'finished' | 'aborted';
  startAt: string | null;
  timeoutSeconds: number;
  winnerId: number | null;
  finishedAt: string | null;
  results: ArenaMatchResult[];
}

export type ArenaQueueStatus =
  | { status: 'idle' }
  | { status: 'waiting'; waitSeconds: number }
  | { status: 'matched'; matchCode: string };

export interface ArenaLeaderboardEntry {
  rank: number;
  userId: number;
  displayName: string;
  rating: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
}

export interface ArenaHistoryEntry {
  code: string;
  levelId: number;
  opponentName: string;
  myRatingBefore: number;
  myRatingAfter: number;
  ratingChange: number;
  didWin: boolean;
  didFinish: boolean;
  elapsedSeconds: number | null;
  finishedAt: string;
}

// ── Rating tier ────────────────────────────────────────────────────────────────

export interface ArenaTier {
  name: string;
  minRating: number;
  color: string;       // Tailwind text color class
  bg: string;          // Tailwind bg class
  border: string;
}

export const ARENA_TIERS: ArenaTier[] = [
  { name: 'Bronze',      minRating: 0,    color: 'text-amber-700',    bg: 'bg-amber-100',    border: 'border-amber-300'  },
  { name: 'Silver',      minRating: 1100, color: 'text-slate-500',    bg: 'bg-slate-100',    border: 'border-slate-300'  },
  { name: 'Gold',        minRating: 1300, color: 'text-yellow-600',   bg: 'bg-yellow-50',    border: 'border-yellow-300' },
  { name: 'Platinum',    minRating: 1500, color: 'text-sky-600',      bg: 'bg-sky-50',       border: 'border-sky-300'    },
  { name: 'Diamond',     minRating: 1700, color: 'text-violet-600',   bg: 'bg-violet-50',    border: 'border-violet-300' },
  { name: 'Master',      minRating: 1900, color: 'text-red-600',      bg: 'bg-red-50',       border: 'border-red-300'    },
  { name: 'Grandmaster', minRating: 2100, color: 'text-rose-700',     bg: 'bg-rose-50',      border: 'border-rose-400'   },
];

export function getArenaTier(rating: number): ArenaTier {
  for (let i = ARENA_TIERS.length - 1; i >= 0; i--) {
    if (rating >= ARENA_TIERS[i].minRating) return ARENA_TIERS[i];
  }
  return ARENA_TIERS[0];
}

// ── API functions ──────────────────────────────────────────────────────────────

export async function fetchArenaProfile(): Promise<ArenaProfile> {
  const res = await request<ArenaProfile>('/api/arena/me');
  return res;
}

export async function joinArenaQueue(): Promise<ArenaQueueStatus> {
  const res = await request<{ status: string; matchCode?: string }>(
    '/api/arena/queue/join', { method: 'POST' },
  );
  if (res.status === 'matched' && res.matchCode) {
    return { status: 'matched', matchCode: res.matchCode };
  }
  return { status: 'waiting', waitSeconds: 0 };
}

export async function leaveArenaQueue(): Promise<void> {
  await request('/api/arena/queue/leave', { method: 'DELETE' });
}

export async function pollArenaQueueStatus(): Promise<ArenaQueueStatus> {
  const res = await request<{ status: string; matchCode?: string; waitSeconds?: number }>(
    '/api/arena/queue/status',
  );
  if (res.status === 'matched' && res.matchCode) {
    return { status: 'matched', matchCode: res.matchCode };
  }
  if (res.status === 'waiting') {
    return { status: 'waiting', waitSeconds: res.waitSeconds ?? 0 };
  }
  return { status: 'idle' };
}

export async function fetchArenaMatch(code: string): Promise<ArenaMatch> {
  const res = await request<{ match: ArenaMatch }>(`/api/arena/match/${code}`);
  return res.match;
}

export async function submitArenaMatchResult(
  code: string,
  payload: { didFinish: boolean; elapsedSeconds: number; remainingSeconds: number },
): Promise<ArenaMatch> {
  const res = await request<{ match: ArenaMatch }>(
    `/api/arena/match/${code}/submit`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return res.match;
}

export async function fetchArenaLeaderboard(): Promise<ArenaLeaderboardEntry[]> {
  const res = await request<{ leaderboard: ArenaLeaderboardEntry[] }>('/api/arena/leaderboard');
  return res.leaderboard;
}

export async function fetchArenaHistory(): Promise<ArenaHistoryEntry[]> {
  const res = await request<{ history: ArenaHistoryEntry[] }>('/api/arena/history');
  return res.history;
}
