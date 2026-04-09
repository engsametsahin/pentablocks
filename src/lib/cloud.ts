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

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787';

interface RequestOptions extends RequestInit {
  allowUnauthorized?: boolean;
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new Error('network_error');
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
