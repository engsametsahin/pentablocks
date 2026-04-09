import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import { OAuth2Client } from 'google-auth-library';
import { pool, ensureSchema, closePool } from './db.mjs';

const app = express();

const API_PORT = Number(process.env.API_PORT ?? 8787);
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3020';
const APP_ORIGINS = process.env.APP_ORIGINS ?? '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? process.env.VITE_GOOGLE_CLIENT_ID ?? '';
const SESSION_COOKIE = 'pb_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const MAX_LEVEL = 100;
const CHALLENGE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHALLENGE_CODE_LENGTH = 8;

app.use(express.json({ limit: '1mb' }));

function deriveCompanionOrigin(origin) {
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host.startsWith('www.')) {
      url.hostname = host.slice(4);
      return url.toString().replace(/\/$/, '');
    }
    if (!host.startsWith('localhost') && host.split('.').length >= 2) {
      url.hostname = `www.${host}`;
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    return null;
  }
  return null;
}

function buildAllowedOrigins() {
  const set = new Set([APP_ORIGIN]);
  for (const raw of APP_ORIGINS.split(',')) {
    const trimmed = raw.trim();
    if (trimmed) set.add(trimmed);
  }
  const companion = deriveCompanionOrigin(APP_ORIGIN);
  if (companion) set.add(companion);
  return set;
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

function corsHeaders(req, res) {
  const requestOrigin = req.headers.origin;
  const allowOrigin = requestOrigin && ALLOWED_ORIGINS.has(requestOrigin) ? requestOrigin : APP_ORIGIN;
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Origin', allowOrigin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
}

app.use((req, res, next) => {
  corsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

function sessionCookieValue(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const parsed = parseCookie(raw);
  return parsed[SESSION_COOKIE] ?? null;
}

function setSessionCookie(res, token) {
  const isSecure = process.env.NODE_ENV === 'production';
  res.header(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecure,
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    }),
  );
}

function clearSessionCookie(res) {
  res.header(
    'Set-Cookie',
    serializeCookie(SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    }),
  );
}

function normalizeDisplayName(input, fallback = 'Guest') {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return fallback;
  return value.slice(0, 32);
}

function normalizeEmail(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  return value;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function createPasswordDigest(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const computed = hashPassword(password, salt);
  const left = Buffer.from(computed, 'hex');
  const right = Buffer.from(expectedHash, 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function toSafeInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function sanitizeCompletedLevels(input) {
  if (!Array.isArray(input)) return [];
  const uniq = new Set();
  for (const item of input) {
    const level = toSafeInt(item, -1);
    if (level >= 1 && level <= 100) uniq.add(level);
  }
  return [...uniq].sort((a, b) => a - b);
}

function sanitizeBestTimes(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, val] of Object.entries(input)) {
    const level = toSafeInt(key, -1);
    const seconds = toSafeInt(val, -1);
    if (level >= 1 && level <= 100 && seconds >= 0) {
      out[level] = seconds;
    }
  }
  return out;
}

function sanitizePlayerStats(input) {
  const source = input && typeof input === 'object' ? input : {};
  const read = (key) => Math.max(0, toSafeInt(source[key], 0));
  return {
    gamesStarted: read('gamesStarted'),
    wins: read('wins'),
    losses: read('losses'),
    restarts: read('restarts'),
    hintsUsed: read('hintsUsed'),
    totalPlaySeconds: read('totalPlaySeconds'),
  };
}

function sanitizeProgress(input) {
  const safe = input && typeof input === 'object' ? input : {};
  const completedLevels = sanitizeCompletedLevels(safe.completedLevels);
  const bestTimes = sanitizeBestTimes(safe.bestTimes);
  const playerStats = sanitizePlayerStats(safe.playerStats);
  const lastLevel = Math.min(MAX_LEVEL, Math.max(1, toSafeInt(safe.lastLevel, 1)));
  return { completedLevels, bestTimes, playerStats, lastLevel };
}

function sanitizeLevelId(input) {
  return Math.min(MAX_LEVEL, Math.max(1, toSafeInt(input, 1)));
}

function normalizeChallengeCode(input) {
  if (typeof input !== 'string') return '';
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CHALLENGE_CODE_LENGTH);
}

function buildChallengeCode() {
  let out = '';
  for (let i = 0; i < CHALLENGE_CODE_LENGTH; i += 1) {
    const idx = Math.floor(Math.random() * CHALLENGE_CODE_ALPHABET.length);
    out += CHALLENGE_CODE_ALPHABET[idx];
  }
  return out;
}

async function createUniqueChallengeCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = buildChallengeCode();
    const existing = await pool.query(
      'SELECT 1 FROM multiplayer_challenges WHERE code = $1 LIMIT 1',
      [code],
    );
    if (existing.rows.length === 0) return code;
  }
  return crypto.randomBytes(6).toString('base64url').toUpperCase().slice(0, CHALLENGE_CODE_LENGTH);
}

function toChallengeDto(row) {
  return {
    id: row.id,
    code: row.code,
    levelId: row.level_id,
    isRanked: row.is_ranked,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    creator: {
      id: row.created_by_user_id,
      displayName: row.creator_display_name,
      provider: row.creator_provider,
    },
  };
}

function toChallengePlayerDto(row) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    provider: row.provider,
    joinedAt: row.joined_at,
    status: row.status,
    didWin: row.did_win,
    elapsedSeconds: row.elapsed_seconds,
    remainingSeconds: row.remaining_seconds,
    submittedAt: row.submitted_at,
  };
}

async function readChallengeByCode(code) {
  const challenge = await pool.query(
    `SELECT c.*,
            u.display_name AS creator_display_name,
            u.provider AS creator_provider
     FROM multiplayer_challenges c
     JOIN users u ON u.id = c.created_by_user_id
     WHERE c.code = $1
     LIMIT 1`,
    [code],
  );

  if (challenge.rows.length === 0) return null;
  const row = challenge.rows[0];
  const players = await pool.query(
    `SELECT p.*,
            u.display_name,
            u.provider
     FROM multiplayer_challenge_players p
     JOIN users u ON u.id = p.user_id
     WHERE p.challenge_id = $1
     ORDER BY
       CASE
         WHEN p.status = 'submitted' AND p.did_win = TRUE THEN 0
         WHEN p.status = 'submitted' AND p.did_win = FALSE THEN 1
         ELSE 2
       END ASC,
       p.elapsed_seconds ASC NULLS LAST,
       p.remaining_seconds DESC NULLS LAST,
       p.joined_at ASC`,
    [row.id],
  );

  return {
    challenge: toChallengeDto(row),
    players: players.rows.map(toChallengePlayerDto),
  };
}

function toUserDto(row) {
  return {
    id: row.id,
    provider: row.provider,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
  };
}

function toProgressDto(row) {
  if (!row) {
    return {
      completedLevels: [],
      bestTimes: {},
      playerStats: sanitizePlayerStats({}),
      lastLevel: 1,
      updatedAt: null,
    };
  }

  return {
    completedLevels: sanitizeCompletedLevels(row.completed_levels),
    bestTimes: sanitizeBestTimes(row.best_times),
    playerStats: sanitizePlayerStats(row.player_stats),
    lastLevel: Math.min(100, Math.max(1, toSafeInt(row.last_level, 1))),
    updatedAt: row.updated_at,
  };
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expiresAt],
  );
  return token;
}

async function readAuthedUser(req) {
  const token = sessionCookieValue(req);
  if (!token) return null;

  const query = await pool.query(
    `SELECT u.*
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()
     LIMIT 1`,
    [token],
  );

  if (query.rows.length === 0) return null;
  return query.rows[0];
}

async function requireUser(req, res) {
  const user = await readAuthedUser(req);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return user;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/guest', async (req, res) => {
  try {
    const nickname = normalizeDisplayName(req.body?.nickname, `Guest-${Math.floor(1000 + Math.random() * 9000)}`);
    const created = await pool.query(
      `INSERT INTO users (provider, display_name)
       VALUES ('guest', $1)
       RETURNING *`,
      [nickname],
    );
    const user = created.rows[0];
    const token = await createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ user: toUserDto(user) });
  } catch (error) {
    console.error('guest auth error', error);
    res.status(500).json({ error: 'guest_auth_failed' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  if (!oauthClient || !GOOGLE_CLIENT_ID) {
    res.status(503).json({ error: 'google_auth_not_configured' });
    return;
  }

  const idToken = req.body?.idToken;
  if (!idToken || typeof idToken !== 'string') {
    res.status(400).json({ error: 'missing_id_token' });
    return;
  }

  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      res.status(401).json({ error: 'invalid_google_payload' });
      return;
    }

    const displayName = normalizeDisplayName(payload.name, 'Google Player');
    const email = typeof payload.email === 'string' ? payload.email : null;
    const avatar = typeof payload.picture === 'string' ? payload.picture : null;

    const upsert = await pool.query(
      `INSERT INTO users (provider, google_sub, email, display_name, avatar_url)
       VALUES ('google', $1, $2, $3, $4)
       ON CONFLICT (google_sub) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         updated_at = NOW()
       RETURNING *`,
      [payload.sub, email, displayName, avatar],
    );

    const user = upsert.rows[0];
    const token = await createSession(user.id);
    setSessionCookie(res, token);
    res.json({ user: toUserDto(user) });
  } catch (error) {
    console.error('google auth error', error);
    res.status(401).json({ error: 'google_auth_failed' });
  }
});

app.post('/api/auth/email/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const displayName = normalizeDisplayName(req.body?.displayName, 'Player');

  if (!email || !isValidEmail(email)) {
    res.status(400).json({ error: 'invalid_email' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'password_too_short' });
    return;
  }

  const existing = await pool.query(
    `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'email_already_registered' });
    return;
  }

  const { salt, hash } = createPasswordDigest(password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const createdUser = await client.query(
      `INSERT INTO users (provider, email, display_name)
       VALUES ('email', $1, $2)
       RETURNING *`,
      [email, displayName],
    );
    const user = createdUser.rows[0];
    await client.query(
      `INSERT INTO user_credentials (user_id, password_hash, password_salt)
       VALUES ($1, $2, $3)`,
      [user.id, hash, salt],
    );
    await client.query('COMMIT');

    const token = await createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ user: toUserDto(user) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('email register error', error);
    res.status(500).json({ error: 'email_register_failed' });
  } finally {
    client.release();
  }
});

app.post('/api/auth/email/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !isValidEmail(email) || !password) {
    res.status(400).json({ error: 'invalid_credentials' });
    return;
  }

  try {
    const userQuery = await pool.query(
      `SELECT u.*, c.password_hash, c.password_salt
       FROM users u
       JOIN user_credentials c ON c.user_id = u.id
       WHERE lower(u.email) = lower($1) AND u.provider = 'email'
       LIMIT 1`,
      [email],
    );
    if (userQuery.rows.length === 0) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    const row = userQuery.rows[0];
    if (!verifyPassword(password, row.password_salt, row.password_hash)) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    const token = await createSession(row.id);
    setSessionCookie(res, token);
    res.json({ user: toUserDto(row) });
  } catch (error) {
    console.error('email login error', error);
    res.status(500).json({ error: 'email_login_failed' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await readAuthedUser(req);
    res.json({ user: user ? toUserDto(user) : null });
  } catch (error) {
    console.error('auth me error', error);
    res.status(500).json({ error: 'auth_me_failed' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = sessionCookieValue(req);
  if (token) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/progress', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const progress = await pool.query(
      `SELECT * FROM user_progress WHERE user_id = $1 LIMIT 1`,
      [user.id],
    );
    res.json({ progress: toProgressDto(progress.rows[0] ?? null) });
  } catch (error) {
    console.error('progress fetch error', error);
    res.status(500).json({ error: 'progress_fetch_failed' });
  }
});

app.put('/api/progress', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const clean = sanitizeProgress(req.body?.progress);

  try {
    const saved = await pool.query(
      `INSERT INTO user_progress (user_id, completed_levels, best_times, player_stats, last_level, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         completed_levels = EXCLUDED.completed_levels,
         best_times = EXCLUDED.best_times,
         player_stats = EXCLUDED.player_stats,
         last_level = EXCLUDED.last_level,
         updated_at = NOW()
       RETURNING *`,
      [
        user.id,
        JSON.stringify(clean.completedLevels),
        JSON.stringify(clean.bestTimes),
        JSON.stringify(clean.playerStats),
        clean.lastLevel,
      ],
    );
    res.json({ progress: toProgressDto(saved.rows[0]) });
  } catch (error) {
    console.error('progress save error', error);
    res.status(500).json({ error: 'progress_save_failed' });
  }
});

app.post('/api/multiplayer/challenges', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const levelId = sanitizeLevelId(req.body?.levelId ?? req.body?.level);

  try {
    const code = await createUniqueChallengeCode();
    const created = await pool.query(
      `INSERT INTO multiplayer_challenges (code, created_by_user_id, level_id, is_ranked, status, updated_at)
       VALUES ($1, $2, $3, $4, 'open', NOW())
       RETURNING *`,
      [code, user.id, levelId, user.provider !== 'guest'],
    );
    const challenge = created.rows[0];
    await pool.query(
      `INSERT INTO multiplayer_challenge_players (challenge_id, user_id, status)
       VALUES ($1, $2, 'joined')
       ON CONFLICT (challenge_id, user_id) DO NOTHING`,
      [challenge.id, user.id],
    );

    const snapshot = await readChallengeByCode(code);
    res.status(201).json(snapshot);
  } catch (error) {
    console.error('multiplayer create challenge error', error);
    res.status(500).json({ error: 'challenge_create_failed' });
  }
});

app.get('/api/multiplayer/challenges/:code', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const code = normalizeChallengeCode(req.params.code);
  if (!code) {
    res.status(400).json({ error: 'invalid_challenge_code' });
    return;
  }

  try {
    const snapshot = await readChallengeByCode(code);
    if (!snapshot) {
      res.status(404).json({ error: 'challenge_not_found' });
      return;
    }
    const isParticipant = snapshot.players.some((player) => player.userId === user.id);
    res.json({ ...snapshot, viewer: { isParticipant } });
  } catch (error) {
    console.error('multiplayer read challenge error', error);
    res.status(500).json({ error: 'challenge_fetch_failed' });
  }
});

app.post('/api/multiplayer/challenges/:code/join', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const code = normalizeChallengeCode(req.params.code);
  if (!code) {
    res.status(400).json({ error: 'invalid_challenge_code' });
    return;
  }

  try {
    const challenge = await pool.query(
      `SELECT id, status
       FROM multiplayer_challenges
       WHERE code = $1
       LIMIT 1`,
      [code],
    );
    if (challenge.rows.length === 0) {
      res.status(404).json({ error: 'challenge_not_found' });
      return;
    }

    const row = challenge.rows[0];
    if (row.status !== 'open') {
      res.status(409).json({ error: 'challenge_closed' });
      return;
    }

    await pool.query(
      `INSERT INTO multiplayer_challenge_players (challenge_id, user_id, status)
       VALUES ($1, $2, 'joined')
       ON CONFLICT (challenge_id, user_id) DO NOTHING`,
      [row.id, user.id],
    );
    if (user.provider === 'guest') {
      await pool.query(
        `UPDATE multiplayer_challenges
         SET is_ranked = FALSE,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );
    }
    await pool.query(
      `UPDATE multiplayer_challenges
       SET updated_at = NOW()
       WHERE id = $1`,
      [row.id],
    );

    const snapshot = await readChallengeByCode(code);
    res.json(snapshot);
  } catch (error) {
    console.error('multiplayer join challenge error', error);
    res.status(500).json({ error: 'challenge_join_failed' });
  }
});

app.post('/api/multiplayer/challenges/:code/submit', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const code = normalizeChallengeCode(req.params.code);
  if (!code) {
    res.status(400).json({ error: 'invalid_challenge_code' });
    return;
  }

  const didWin = Boolean(req.body?.didWin);
  const elapsedSeconds = Math.max(0, toSafeInt(req.body?.elapsedSeconds, 0));
  const remainingSeconds = Math.max(0, toSafeInt(req.body?.remainingSeconds, 0));

  try {
    const challenge = await pool.query(
      `SELECT id, status
       FROM multiplayer_challenges
       WHERE code = $1
       LIMIT 1`,
      [code],
    );
    if (challenge.rows.length === 0) {
      res.status(404).json({ error: 'challenge_not_found' });
      return;
    }

    const challengeRow = challenge.rows[0];
    if (challengeRow.status !== 'open') {
      res.status(409).json({ error: 'challenge_closed' });
      return;
    }

    await pool.query(
      `INSERT INTO multiplayer_challenge_players (
         challenge_id,
         user_id,
         status,
         did_win,
         elapsed_seconds,
         remaining_seconds,
         submitted_at
       )
       VALUES ($1, $2, 'submitted', $3, $4, $5, NOW())
       ON CONFLICT (challenge_id, user_id) DO UPDATE SET
         status = 'submitted',
         did_win = EXCLUDED.did_win,
         elapsed_seconds = EXCLUDED.elapsed_seconds,
         remaining_seconds = EXCLUDED.remaining_seconds,
         submitted_at = NOW()`,
      [challengeRow.id, user.id, didWin, elapsedSeconds, remainingSeconds],
    );

    const submittedCount = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM multiplayer_challenge_players
       WHERE challenge_id = $1 AND status = 'submitted'`,
      [challengeRow.id],
    );

    const hasGuestParticipant = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM multiplayer_challenge_players p
         JOIN users u ON u.id = p.user_id
         WHERE p.challenge_id = $1
           AND u.provider = 'guest'
       ) AS has_guest`,
      [challengeRow.id],
    );
    const shouldBeRanked = !hasGuestParticipant.rows[0].has_guest;

    if (submittedCount.rows[0].count >= 2) {
      await pool.query(
        `UPDATE multiplayer_challenges
         SET status = 'closed',
             is_ranked = $2,
             closed_at = COALESCE(closed_at, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [challengeRow.id, shouldBeRanked],
      );
    } else {
      await pool.query(
        `UPDATE multiplayer_challenges
         SET is_ranked = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [challengeRow.id, shouldBeRanked],
      );
    }

    const snapshot = await readChallengeByCode(code);
    res.json(snapshot);
  } catch (error) {
    console.error('multiplayer submit result error', error);
    res.status(500).json({ error: 'challenge_submit_failed' });
  }
});

async function start() {
  await ensureSchema();
  await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
  app.listen(API_PORT, () => {
    console.info(`[api] running on http://localhost:${API_PORT}`);
  });
}

start().catch((error) => {
  console.error('failed to start api', error);
  process.exit(1);
});

process.on('SIGINT', async () => {
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closePool();
  process.exit(0);
});
