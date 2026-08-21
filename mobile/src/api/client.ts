import { clearSessionToken, getSessionToken, saveSessionToken } from "./session";
import { CloudProgress, CloudUser } from "./types";

const API_ORIGIN = (process.env.EXPO_PUBLIC_API_URL ?? "https://pentablocks.live").replace(/\/$/, "");
const REQUEST_TIMEOUT_MS = 12_000;

interface RequestOptions extends RequestInit {
  authenticated?: boolean;
}

interface AuthResponse {
  user: CloudUser;
  sessionToken: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { authenticated = true, headers, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const token = authenticated ? await getSessionToken() : null;

  try {
    const response = await fetch(`${API_ORIGIN}/api${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-PentaBlocks-Client": "android",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && token) await clearSessionToken();
      const code = typeof payload?.error === "string" ? payload.error : "request_failed";
      throw new ApiError(code.replaceAll("_", " "), response.status, code);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError("The server took too long to respond.", 0, "request_timeout");
    }
    throw new ApiError("Cannot reach the PentaBlocks server.", 0, "network_error");
  } finally {
    clearTimeout(timeout);
  }
}

async function finishAuth(request: Promise<AuthResponse>) {
  const response = await request;
  if (!response.sessionToken) {
    throw new ApiError("The server did not return a mobile session.", 500, "missing_session_token");
  }
  await saveSessionToken(response.sessionToken);
  return response.user;
}

export function registerNickname(nickname: string, password: string) {
  return finishAuth(apiRequest<AuthResponse>("/auth/nickname/register", {
    method: "POST",
    authenticated: false,
    body: JSON.stringify({ nickname, password }),
  }));
}

export function loginNickname(nickname: string, password: string) {
  return finishAuth(apiRequest<AuthResponse>("/auth/nickname/login", {
    method: "POST",
    authenticated: false,
    body: JSON.stringify({ nickname, password }),
  }));
}

export function loginGoogle(idToken: string) {
  return finishAuth(apiRequest<AuthResponse>("/auth/google", {
    method: "POST",
    authenticated: false,
    body: JSON.stringify({ idToken }),
  }));
}

export function continueAsGuest(nickname: string) {
  return finishAuth(apiRequest<AuthResponse>("/auth/guest", {
    method: "POST",
    authenticated: false,
    body: JSON.stringify({ nickname }),
  }));
}

export async function fetchCurrentUser() {
  if (!await getSessionToken()) return null;
  try {
    const response = await apiRequest<{ user: CloudUser | null }>("/auth/me");
    if (!response.user) await clearSessionToken();
    return response.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export async function signOut() {
  try {
    await apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST" });
  } finally {
    await clearSessionToken();
  }
}

export async function fetchProgress() {
  const response = await apiRequest<{ progress: CloudProgress }>("/progress");
  return response.progress;
}

export async function saveProgress(progress: CloudProgress) {
  const response = await apiRequest<{ progress: CloudProgress }>("/progress", {
    method: "PUT",
    body: JSON.stringify({ progress }),
  });
  return response.progress;
}
