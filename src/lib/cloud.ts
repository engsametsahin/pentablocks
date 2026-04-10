export interface CloudUser {
  id: number;
  provider: 'guest' | 'google' | 'email';
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface CloudPlayerStats {
  gamesStarted: number;
  wins: number;
  losses: number;
  restarts: number;
  hintsUsed: number;
  totalPlaySeconds: number;
}

export interface CloudProgress {
  completedLevels: number[];
  bestTimes: Record<number, number>;
  playerStats: CloudPlayerStats;
  lastLevel: number;
  updatedAt: string | null;
}

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

interface RequestOptions extends RequestInit {
  allowUnauthorized?: boolean;
}

const API_REQUEST_TIMEOUT_MS = 12000;

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = buildApiUrl(path);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('request_timeout');
    }
    throw new Error('network_error');
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 401 && options.allowUnauthorized) {
      return null as T;
    }

    let message = `request_failed_${response.status}`;
    try {
      const payload = await response.json() as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // Keep fallback message.
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export async function fetchCurrentUser() {
  const payload = await apiRequest<{ user: CloudUser | null }>('/api/auth/me', { method: 'GET', allowUnauthorized: true });
  return payload?.user ?? null;
}

export async function signInGuest(nickname?: string) {
  const payload = await apiRequest<{ user: CloudUser }>('/api/auth/guest', {
    method: 'POST',
    body: JSON.stringify({ nickname }),
  });
  return payload.user;
}

export async function updateGuestNickname(nickname: string) {
  const payload = await apiRequest<{ user: CloudUser }>('/api/auth/guest/nickname', {
    method: 'PUT',
    body: JSON.stringify({ nickname }),
  });
  return payload.user;
}

export async function signInGoogle(idToken: string) {
  const payload = await apiRequest<{ user: CloudUser }>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  });
  return payload.user;
}

export async function signUpEmail(params: { email: string; password: string; displayName?: string }) {
  const payload = await apiRequest<{ user: CloudUser }>('/api/auth/email/register', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return payload.user;
}

export async function signInEmail(params: { email: string; password: string }) {
  const payload = await apiRequest<{ user: CloudUser }>('/api/auth/email/login', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return payload.user;
}

export async function signOutCloud() {
  await apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST', allowUnauthorized: true });
}

export async function fetchCloudProgress() {
  const payload = await apiRequest<{ progress: CloudProgress }>('/api/progress', { method: 'GET' });
  return payload.progress;
}

export async function saveCloudProgress(progress: Omit<CloudProgress, 'updatedAt'>) {
  const payload = await apiRequest<{ progress: CloudProgress }>('/api/progress', {
    method: 'PUT',
    body: JSON.stringify({ progress }),
  });
  return payload.progress;
}
