import type { CloudUser } from './cloud';

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
    const strippedPath = normalizedPath.replace(/^\/api/i, '');
    return `${API_BASE}${strippedPath || '/'}`;
  }

  return `${API_BASE}${normalizedPath}`;
}

async function request<T>(path: string, options: RequestInit = {}) {
  const response = await fetch(buildApiUrl(path), {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `request_failed_${response.status}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // no-op
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export interface MultiplayerChallenge {
  id: number;
  code: string;
  levelId: number;
  puzzleSeed: string;
  isRanked: boolean;
  status: 'open' | 'closed';
  startAt: string | null;
  winnerUserId: number | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  creator: {
    id: number;
    displayName: string;
    provider: CloudUser['provider'];
  };
}

export interface MultiplayerChallengePlayer {
  userId: number;
  displayName: string;
  provider: CloudUser['provider'];
  joinedAt: string;
  readyAt: string | null;
  status: 'joined' | 'ready' | 'submitted';
  didWin: boolean | null;
  elapsedSeconds: number | null;
  remainingSeconds: number | null;
  submittedAt: string | null;
}

export interface MultiplayerChallengeSnapshot {
  challenge: MultiplayerChallenge;
  players: MultiplayerChallengePlayer[];
}

export interface MultiplayerStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  totalPlaySeconds: number;
  bestElapsedSeconds: number | null;
  updatedAt: string | null;
}

export async function createMultiplayerChallenge(levelId: number) {
  return request<MultiplayerChallengeSnapshot>('/api/multiplayer/challenges', {
    method: 'POST',
    body: JSON.stringify({ levelId }),
  });
}

export async function fetchMultiplayerChallenge(code: string) {
  return request<MultiplayerChallengeSnapshot & { viewer?: { isParticipant?: boolean } }>(
    `/api/multiplayer/challenges/${encodeURIComponent(code)}`,
    { method: 'GET' },
  );
}

export async function joinMultiplayerChallenge(code: string) {
  return request<MultiplayerChallengeSnapshot>(
    `/api/multiplayer/challenges/${encodeURIComponent(code)}/join`,
    { method: 'POST' },
  );
}

export async function startMultiplayerChallenge(code: string) {
  return request<MultiplayerChallengeSnapshot>(
    `/api/multiplayer/challenges/${encodeURIComponent(code)}/start`,
    { method: 'POST' },
  );
}

export async function submitMultiplayerChallengeResult(
  code: string,
  payload: { didWin: boolean; elapsedSeconds: number; remainingSeconds: number },
) {
  return request<MultiplayerChallengeSnapshot>(
    `/api/multiplayer/challenges/${encodeURIComponent(code)}/submit`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export async function fetchMultiplayerStats() {
  return request<{ stats: MultiplayerStats }>('/api/multiplayer/stats', { method: 'GET' });
}
