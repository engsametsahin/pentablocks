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
const MATCH_START_DELAY_SECONDS = 5;
const ROOM_START_DELAY_SECONDS = 5;
const ROOM_ROUND_TIMEOUT_SECONDS = 240;
const ROOM_DEFAULT_MAX_PLAYERS = 8;
const ROOM_MIN_PLAYERS_TO_START = 2;
const ROOM_DIFFICULTY_START_LEVELS = {
  easy: 10,
  moderate: 30,
  hard: 60,
  very_hard: 85,
};

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

function buildPuzzleSeed() {
  return crypto.randomBytes(16).toString('hex');
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

async function createUniqueRoomCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = buildChallengeCode();
    const existing = await pool.query(
      'SELECT 1 FROM multiplayer_rooms WHERE code = $1 LIMIT 1',
      [code],
    );
    if (existing.rows.length === 0) return code;
  }
  return crypto.randomBytes(6).toString('base64url').toUpperCase().slice(0, CHALLENGE_CODE_LENGTH);
}

function sanitizeTotalRounds(input) {
  const rounds = toSafeInt(input, 3);
  return Math.min(10, Math.max(1, rounds));
}

function sanitizeMaxPlayers(input) {
  if (input === undefined || input === null) return ROOM_DEFAULT_MAX_PLAYERS;
  const maxPlayers = toSafeInt(input, ROOM_DEFAULT_MAX_PLAYERS);
  return Math.min(ROOM_DEFAULT_MAX_PLAYERS, Math.max(2, maxPlayers));
}

function sanitizeRoomDifficulty(input) {
  const normalized = typeof input === 'string'
    ? input.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : '';
  if (Object.prototype.hasOwnProperty.call(ROOM_DIFFICULTY_START_LEVELS, normalized)) return normalized;
  return 'moderate';
}

function toChallengeDto(row) {
  return {
    id: row.id,
    code: row.code,
    levelId: row.level_id,
    puzzleSeed: row.puzzle_seed,
    isRanked: row.is_ranked,
    status: row.status,
    startAt: row.start_at,
    winnerUserId: row.winner_user_id,
    endedAt: row.ended_at,
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
  const status = row.status === 'submitted'
    ? 'submitted'
    : (row.ready_at ? 'ready' : 'joined');
  return {
    userId: row.user_id,
    displayName: row.display_name,
    provider: row.provider,
    joinedAt: row.joined_at,
    readyAt: row.ready_at,
    status,
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

async function userIsChallengeParticipant(challengeId, userId) {
  const check = await pool.query(
    `SELECT 1
     FROM multiplayer_challenge_players
     WHERE challenge_id = $1 AND user_id = $2
     LIMIT 1`,
    [challengeId, userId],
  );
  return check.rows.length > 0;
}

function toRoomDto(row) {
  return {
    id: row.id,
    code: row.code,
    levelId: row.level_id,
    difficulty: row.difficulty,
    totalRounds: row.total_rounds,
    maxPlayers: row.max_players,
    isRanked: row.is_ranked,
    status: row.status,
    currentRound: row.current_round,
    championUserId: row.champion_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    host: {
      id: row.created_by_user_id,
      displayName: row.host_display_name,
      provider: row.host_provider,
    },
  };
}

function toRoomPlayerDto(row) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    provider: row.provider,
    joinedAt: row.joined_at,
    totalPoints: row.total_points,
  };
}

function toRoomSubmissionDto(row) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    provider: row.provider,
    submittedAt: row.submitted_at,
    elapsedSeconds: row.elapsed_seconds,
    remainingSeconds: row.remaining_seconds,
    didFinish: row.did_finish,
    pointsAwarded: row.points_awarded,
    placement: row.placement,
  };
}

function toRoomRoundDto(row, submissions) {
  if (!row) return null;
  return {
    id: row.id,
    roundNumber: row.round_number,
    levelId: row.level_id,
    puzzleSeed: row.puzzle_seed,
    startAt: row.start_at,
    status: row.status,
    endedAt: row.ended_at,
    submissions,
  };
}

async function userIsRoomParticipant(roomId, userId) {
  const check = await pool.query(
    `SELECT 1
     FROM multiplayer_room_players
     WHERE room_id = $1 AND user_id = $2
     LIMIT 1`,
    [roomId, userId],
  );
  return check.rows.length > 0;
}

async function readRoomByCode(code) {
  const roomQuery = await pool.query(
    `SELECT r.*,
            u.display_name AS host_display_name,
            u.provider AS host_provider
     FROM multiplayer_rooms r
     JOIN users u ON u.id = r.created_by_user_id
     WHERE r.code = $1
     LIMIT 1`,
    [code],
  );
  if (roomQuery.rows.length === 0) return null;
  const roomRow = roomQuery.rows[0];

  const playersQuery = await pool.query(
    `SELECT p.*, u.display_name, u.provider
     FROM multiplayer_room_players p
     JOIN users u ON u.id = p.user_id
     WHERE p.room_id = $1
     ORDER BY p.total_points DESC, p.joined_at ASC`,
    [roomRow.id],
  );
  const players = playersQuery.rows.map(toRoomPlayerDto);

  let roundRow = null;
  let submissions = [];
  if (roomRow.current_round > 0) {
    const roundQuery = await pool.query(
      `SELECT *
       FROM multiplayer_room_rounds
       WHERE room_id = $1 AND round_number = $2
       LIMIT 1`,
      [roomRow.id, roomRow.current_round],
    );
    roundRow = roundQuery.rows[0] ?? null;
    if (roundRow) {
      const subQuery = await pool.query(
        `SELECT s.*, u.display_name, u.provider
         FROM multiplayer_room_submissions s
         JOIN users u ON u.id = s.user_id
         WHERE s.round_id = $1
         ORDER BY
           CASE WHEN s.placement IS NULL THEN 1 ELSE 0 END ASC,
           s.placement ASC NULLS LAST,
           s.elapsed_seconds ASC,
           s.submitted_at ASC`,
        [roundRow.id],
      );
      submissions = subQuery.rows.map(toRoomSubmissionDto);
    }
  }

  return {
    room: toRoomDto(roomRow),
    players,
    activeRound: toRoomRoundDto(roundRow, submissions),
  };
}

async function startRoomRound(client, roomRow, roundNumber) {
  const puzzleSeed = buildPuzzleSeed();
  const roundLevelId = Math.min(MAX_LEVEL, Math.max(1, roomRow.level_id + (roundNumber - 1)));
  await client.query(
    `INSERT INTO multiplayer_room_rounds (
       room_id,
       round_number,
       level_id,
       puzzle_seed,
       start_at,
       timeout_seconds,
       deadline_at,
       status,
       updated_at
     )
     VALUES (
       $1,
       $2,
       $3,
       $4,
       NOW() + make_interval(secs => $5::int),
       $6,
       NOW() + make_interval(secs => ($5::int + $6::int)),
       'active',
       NOW()
     )
     ON CONFLICT (room_id, round_number) DO NOTHING`,
    [
      roomRow.id,
      roundNumber,
      roundLevelId,
      puzzleSeed,
      ROOM_START_DELAY_SECONDS,
      ROOM_ROUND_TIMEOUT_SECONDS,
    ],
  );
  await client.query(
    `UPDATE multiplayer_rooms
     SET status = 'in_progress',
         current_round = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [roomRow.id, roundNumber],
  );
}

async function finalizeRoomRound(client, roomRow, roundRow, includeTimeoutDnfs) {
  const roomPlayers = await client.query(
    `SELECT user_id
     FROM multiplayer_room_players
     WHERE room_id = $1`,
    [roomRow.id],
  );
  const submissions = await client.query(
    `SELECT user_id
     FROM multiplayer_room_submissions
     WHERE round_id = $1
     FOR UPDATE`,
    [roundRow.id],
  );
  const submittedUserIds = new Set(submissions.rows.map((row) => Number(row.user_id)));

  if (includeTimeoutDnfs) {
    for (const player of roomPlayers.rows) {
      const playerId = Number(player.user_id);
      if (submittedUserIds.has(playerId)) continue;
      await client.query(
        `INSERT INTO multiplayer_room_submissions (
           round_id,
           user_id,
           elapsed_seconds,
           remaining_seconds,
           did_finish,
           points_awarded,
           placement,
           submitted_at
         )
         VALUES ($1, $2, 0, 0, FALSE, 0, NULL, NOW())
         ON CONFLICT (round_id, user_id) DO NOTHING`,
        [roundRow.id, playerId],
      );
    }
  }

  const rankingQuery = await client.query(
    `SELECT user_id
     FROM multiplayer_room_submissions
     WHERE round_id = $1
       AND did_finish = TRUE
     ORDER BY remaining_seconds DESC, elapsed_seconds ASC, submitted_at ASC`,
    [roundRow.id],
  );
  const scoreByPlace = { 1: 5, 2: 3, 3: 1 };
  for (let index = 0; index < rankingQuery.rows.length; index += 1) {
    const row = rankingQuery.rows[index];
    const placement = index + 1;
    const points = scoreByPlace[placement] ?? 0;
    await client.query(
      `UPDATE multiplayer_room_submissions
       SET placement = $2,
           points_awarded = $3
       WHERE round_id = $1
         AND user_id = $4`,
      [roundRow.id, placement, points, row.user_id],
    );
    if (points > 0) {
      await client.query(
        `UPDATE multiplayer_room_players
         SET total_points = total_points + $3
         WHERE room_id = $1
           AND user_id = $2`,
        [roomRow.id, row.user_id, points],
      );
    }
  }

  await client.query(
    `UPDATE multiplayer_room_rounds
     SET status = 'finished',
         ended_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [roundRow.id],
  );

  if (roomRow.current_round >= roomRow.total_rounds) {
    const championQuery = await client.query(
      `SELECT p.user_id
       FROM multiplayer_room_players p
       LEFT JOIN multiplayer_room_submissions s ON s.user_id = p.user_id
       LEFT JOIN multiplayer_room_rounds r ON r.id = s.round_id AND r.room_id = p.room_id
       WHERE p.room_id = $1
       GROUP BY p.user_id, p.total_points, p.joined_at
       ORDER BY p.total_points DESC, COALESCE(SUM(CASE WHEN s.did_finish THEN s.elapsed_seconds END), 999999) ASC, p.joined_at ASC
       LIMIT 1`,
      [roomRow.id],
    );
    const championUserId = championQuery.rows[0]?.user_id ?? null;
    await client.query(
      `UPDATE multiplayer_rooms
       SET status = 'finished',
           champion_user_id = $2,
           closed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [roomRow.id, championUserId],
    );
  } else {
    await startRoomRound(client, roomRow, roomRow.current_round + 1);
  }
}

async function finalizeTimedOutRoomRoundIfNeeded(code) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roomQuery = await client.query(
      `SELECT *
       FROM multiplayer_rooms
       WHERE code = $1
       LIMIT 1
       FOR UPDATE`,
      [code],
    );
    if (roomQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }
    const room = roomQuery.rows[0];
    if (room.status !== 'in_progress' || room.current_round <= 0) {
      await client.query('COMMIT');
      return;
    }

    const roundQuery = await client.query(
      `SELECT *
       FROM multiplayer_room_rounds
       WHERE room_id = $1 AND round_number = $2
       LIMIT 1
       FOR UPDATE`,
      [room.id, room.current_round],
    );
    if (roundQuery.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }
    const round = roundQuery.rows[0];
    if (round.status !== 'active') {
      await client.query('COMMIT');
      return;
    }
    if (new Date(round.deadline_at).getTime() > Date.now()) {
      await client.query('COMMIT');
      return;
    }

    await finalizeRoomRound(client, room, round, true);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('multiplayer room timeout finalize error', error);
  } finally {
    client.release();
  }
}

async function updateRegisteredMultiplayerStats(userId, didWin, elapsedSeconds) {
  await pool.query(
    `INSERT INTO user_multiplayer_stats (
       user_id,
       matches_played,
       wins,
       losses,
       total_play_seconds,
       best_elapsed_seconds,
       updated_at
     )
     VALUES ($1, 1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       matches_played = user_multiplayer_stats.matches_played + 1,
       wins = user_multiplayer_stats.wins + $2,
       losses = user_multiplayer_stats.losses + $3,
       total_play_seconds = user_multiplayer_stats.total_play_seconds + $4,
       best_elapsed_seconds = CASE
         WHEN user_multiplayer_stats.best_elapsed_seconds IS NULL THEN $5
         WHEN $5 IS NULL THEN user_multiplayer_stats.best_elapsed_seconds
         ELSE LEAST(user_multiplayer_stats.best_elapsed_seconds, $5)
       END,
       updated_at = NOW()`,
    [userId, didWin ? 1 : 0, didWin ? 0 : 1, elapsedSeconds, elapsedSeconds],
  );
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
    const puzzleSeed = buildPuzzleSeed();
    const created = await pool.query(
      `INSERT INTO multiplayer_challenges (code, created_by_user_id, level_id, puzzle_seed, is_ranked, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'open', NOW())
       RETURNING *`,
      [code, user.id, levelId, puzzleSeed, user.provider !== 'guest'],
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

    const seats = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM multiplayer_challenge_players
       WHERE challenge_id = $1`,
      [row.id],
    );
    const alreadyParticipant = await userIsChallengeParticipant(row.id, user.id);
    if (seats.rows[0].count >= 2 && !alreadyParticipant) {
      res.status(409).json({ error: 'challenge_full' });
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

app.post('/api/multiplayer/challenges/:code/start', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const code = normalizeChallengeCode(req.params.code);
  if (!code) {
    res.status(400).json({ error: 'invalid_challenge_code' });
    return;
  }

  try {
    const challengeQuery = await pool.query(
      `SELECT id, status, start_at
       FROM multiplayer_challenges
       WHERE code = $1
       LIMIT 1`,
      [code],
    );
    if (challengeQuery.rows.length === 0) {
      res.status(404).json({ error: 'challenge_not_found' });
      return;
    }

    const challenge = challengeQuery.rows[0];
    const isParticipant = await userIsChallengeParticipant(challenge.id, user.id);
    if (!isParticipant) {
      res.status(403).json({ error: 'challenge_forbidden' });
      return;
    }
    if (challenge.status === 'closed') {
      const snapshot = await readChallengeByCode(code);
      res.json(snapshot);
      return;
    }

    if (!challenge.start_at) {
      await pool.query(
        `UPDATE multiplayer_challenge_players
         SET ready_at = COALESCE(ready_at, NOW())
         WHERE challenge_id = $1
           AND user_id = $2`,
        [challenge.id, user.id],
      );

      const participantCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM multiplayer_challenge_players
         WHERE challenge_id = $1`,
        [challenge.id],
      );
      if (participantCount.rows[0].count < 2) {
        res.status(409).json({ error: 'challenge_waiting_for_opponent' });
        return;
      }

      const readyCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM multiplayer_challenge_players
         WHERE challenge_id = $1
           AND ready_at IS NOT NULL`,
        [challenge.id],
      );
      if (readyCount.rows[0].count < 2) {
        res.status(409).json({ error: 'challenge_waiting_for_other_player' });
        return;
      }

      await pool.query(
        `UPDATE multiplayer_challenges
         SET start_at = NOW() + make_interval(secs => $2::int),
             updated_at = NOW()
         WHERE id = $1
           AND start_at IS NULL`,
        [challenge.id, MATCH_START_DELAY_SECONDS],
      );
    }

    const snapshot = await readChallengeByCode(code);
    res.json(snapshot);
  } catch (error) {
    console.error('multiplayer start challenge error', error);
    res.status(500).json({ error: 'challenge_start_failed' });
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

  const didWinInput = Boolean(req.body?.didWin);
  const elapsedSeconds = Math.max(0, toSafeInt(req.body?.elapsedSeconds, 0));
  const remainingSeconds = Math.max(0, toSafeInt(req.body?.remainingSeconds, 0));

  try {
    const challenge = await pool.query(
      `SELECT id, status, winner_user_id
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
    const isParticipant = await userIsChallengeParticipant(challengeRow.id, user.id);
    if (!isParticipant) {
      res.status(403).json({ error: 'challenge_forbidden' });
      return;
    }

    const existingSubmission = await pool.query(
      `SELECT status
       FROM multiplayer_challenge_players
       WHERE challenge_id = $1 AND user_id = $2
       LIMIT 1`,
      [challengeRow.id, user.id],
    );
    const alreadySubmitted = existingSubmission.rows[0]?.status === 'submitted';

    if (challengeRow.status === 'closed' && alreadySubmitted) {
      const snapshot = await readChallengeByCode(code);
      res.json(snapshot);
      return;
    }

    const effectiveDidWin = didWinInput && !challengeRow.winner_user_id;

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
      [challengeRow.id, user.id, effectiveDidWin, elapsedSeconds, remainingSeconds],
    );

    if (effectiveDidWin) {
      await pool.query(
        `UPDATE multiplayer_challenges
         SET winner_user_id = $2,
             status = 'closed',
             ended_at = NOW(),
             closed_at = COALESCE(closed_at, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [challengeRow.id, user.id],
      );
    }

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

    if (!effectiveDidWin) {
      const submittedCount = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM multiplayer_challenge_players
         WHERE challenge_id = $1 AND status = 'submitted'`,
        [challengeRow.id],
      );
      await pool.query(
        `UPDATE multiplayer_challenges
         SET status = CASE WHEN $2 >= 2 THEN 'closed' ELSE status END,
             is_ranked = $3,
             ended_at = CASE WHEN $2 >= 2 THEN COALESCE(ended_at, NOW()) ELSE ended_at END,
             closed_at = CASE WHEN $2 >= 2 THEN COALESCE(closed_at, NOW()) ELSE closed_at END,
             updated_at = NOW()
         WHERE id = $1`,
        [challengeRow.id, submittedCount.rows[0].count, shouldBeRanked],
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

    if (!alreadySubmitted && user.provider !== 'guest') {
      await updateRegisteredMultiplayerStats(user.id, effectiveDidWin, elapsedSeconds);
    }

    const snapshot = await readChallengeByCode(code);
    res.json(snapshot);
  } catch (error) {
    console.error('multiplayer submit result error', error);
    res.status(500).json({ error: 'challenge_submit_failed' });
  }
});

app.post('/api/multiplayer/rooms', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const difficulty = sanitizeRoomDifficulty(req.body?.difficulty);
  const levelId = ROOM_DIFFICULTY_START_LEVELS[difficulty];
  const totalRounds = sanitizeTotalRounds(req.body?.totalRounds);
  const maxPlayers = sanitizeMaxPlayers(req.body?.maxPlayers);

  try {
    const code = await createUniqueRoomCode();
    const created = await pool.query(
      `INSERT INTO multiplayer_rooms (
         code,
         created_by_user_id,
         level_id,
         difficulty,
         total_rounds,
         max_players,
         is_ranked,
       status,
       current_round,
       updated_at
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', 0, NOW())
       RETURNING *`,
      [code, user.id, levelId, difficulty, totalRounds, maxPlayers, user.provider !== 'guest'],
    );
    const room = created.rows[0];
    await pool.query(
      `INSERT INTO multiplayer_room_players (room_id, user_id, total_points)
       VALUES ($1, $2, 0)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [room.id, user.id],
    );

    const snapshot = await readRoomByCode(code);
    res.status(201).json(snapshot);
  } catch (error) {
    console.error('multiplayer create room error', error);
    res.status(500).json({ error: 'room_create_failed' });
  }
});

app.get('/api/multiplayer/rooms/:code', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const code = normalizeChallengeCode(req.params.code);
  if (!code) {
    res.status(400).json({ error: 'invalid_room_code' });
    return;
  }

  try {
    await finalizeTimedOutRoomRoundIfNeeded(code);
    const snapshot = await readRoomByCode(code);
    if (!snapshot) {
      res.status(404).json({ error: 'room_not_found' });
      return;
    }
    const isParticipant = snapshot.players.some((player) => player.userId === user.id);
    res.json({ ...snapshot, viewer: { isParticipant } });
  } catch (error) {
    console.error('multiplayer read room error', error);
    res.status(500).json({ error: 'room_fetch_failed' });
  }
});

app.post('/api/multiplayer/rooms/:code/join', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const code = normalizeChallengeCode(req.params.code);
  if (!code) {
    res.status(400).json({ error: 'invalid_room_code' });
    return;
  }

  try {
    const roomQuery = await pool.query(
      `SELECT id, status, max_players
       FROM multiplayer_rooms
       WHERE code = $1
       LIMIT 1`,
      [code],
    );
    if (roomQuery.rows.length === 0) {
      res.status(404).json({ error: 'room_not_found' });
      return;
    }
    const room = roomQuery.rows[0];
    if (room.status !== 'open') {
      res.status(409).json({ error: 'room_closed' });
      return;
    }

    const seats = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM multiplayer_room_players
       WHERE room_id = $1`,
      [room.id],
    );
    const alreadyParticipant = await userIsRoomParticipant(room.id, user.id);
    if (seats.rows[0].count >= room.max_players && !alreadyParticipant) {
      res.status(409).json({ error: 'room_full' });
      return;
    }

    await pool.query(
      `INSERT INTO multiplayer_room_players (room_id, user_id, total_points)
       VALUES ($1, $2, 0)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [room.id, user.id],
    );

    if (user.provider === 'guest') {
      await pool.query(
        `UPDATE multiplayer_rooms
         SET is_ranked = FALSE,
             updated_at = NOW()
         WHERE id = $1`,
        [room.id],
      );
    } else {
      await pool.query(
        `UPDATE multiplayer_rooms
         SET updated_at = NOW()
         WHERE id = $1`,
        [room.id],
      );
    }

    const snapshot = await readRoomByCode(code);
    res.json(snapshot);
  } catch (error) {
    console.error('multiplayer join room error', error);
    res.status(500).json({ error: 'room_join_failed' });
  }
});

app.post('/api/multiplayer/rooms/:code/start', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const code = normalizeChallengeCode(req.params.code);
  if (!code) {
    res.status(400).json({ error: 'invalid_room_code' });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roomQuery = await client.query(
      `SELECT *
       FROM multiplayer_rooms
       WHERE code = $1
       LIMIT 1
       FOR UPDATE`,
      [code],
    );
    if (roomQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'room_not_found' });
      return;
    }

    const room = roomQuery.rows[0];
    if (room.created_by_user_id !== user.id) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'room_not_host' });
      return;
    }
    if (room.status === 'finished') {
      await client.query('ROLLBACK');
      const snapshot = await readRoomByCode(code);
      res.json(snapshot);
      return;
    }
    if (room.status === 'in_progress') {
      await client.query('ROLLBACK');
      const snapshot = await readRoomByCode(code);
      res.json(snapshot);
      return;
    }

    const participantsQuery = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM multiplayer_room_players
       WHERE room_id = $1`,
      [room.id],
    );
    if (participantsQuery.rows[0].count < ROOM_MIN_PLAYERS_TO_START) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'room_not_enough_players' });
      return;
    }

    await startRoomRound(client, room, 1);
    await client.query('COMMIT');
    const snapshot = await readRoomByCode(code);
    res.json(snapshot);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('multiplayer start room error', error);
    res.status(500).json({ error: 'room_start_failed' });
  } finally {
    client.release();
  }
});

app.post('/api/multiplayer/rooms/:code/submit', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const code = normalizeChallengeCode(req.params.code);
  if (!code) {
    res.status(400).json({ error: 'invalid_room_code' });
    return;
  }

  const roundNumberInput = Math.max(1, toSafeInt(req.body?.roundNumber, 1));
  const elapsedSeconds = Math.max(0, toSafeInt(req.body?.elapsedSeconds, 0));
  const remainingSeconds = Math.max(0, toSafeInt(req.body?.remainingSeconds, 0));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const roomQuery = await client.query(
      `SELECT *
       FROM multiplayer_rooms
       WHERE code = $1
       LIMIT 1
       FOR UPDATE`,
      [code],
    );
    if (roomQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'room_not_found' });
      return;
    }
    const room = roomQuery.rows[0];
    if (room.status !== 'in_progress') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'room_not_active' });
      return;
    }

    const isParticipant = await userIsRoomParticipant(room.id, user.id);
    if (!isParticipant) {
      await client.query('ROLLBACK');
      res.status(403).json({ error: 'room_forbidden' });
      return;
    }

    if (room.current_round !== roundNumberInput) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'room_round_mismatch' });
      return;
    }

    const roundQuery = await client.query(
      `SELECT *
       FROM multiplayer_room_rounds
       WHERE room_id = $1 AND round_number = $2
       LIMIT 1
       FOR UPDATE`,
      [room.id, room.current_round],
    );
    if (roundQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'room_round_not_found' });
      return;
    }
    const round = roundQuery.rows[0];
    if (round.status !== 'active') {
      await client.query('ROLLBACK');
      const snapshot = await readRoomByCode(code);
      res.json(snapshot);
      return;
    }
    if (new Date(round.deadline_at).getTime() <= Date.now()) {
      await finalizeRoomRound(client, room, round, true);
      await client.query('COMMIT');
      const snapshot = await readRoomByCode(code);
      res.json(snapshot);
      return;
    }

    await client.query(
      `INSERT INTO multiplayer_room_submissions (
         round_id,
         user_id,
         elapsed_seconds,
         remaining_seconds,
         did_finish,
         submitted_at
       )
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       ON CONFLICT (round_id, user_id) DO UPDATE SET
         elapsed_seconds = EXCLUDED.elapsed_seconds,
         remaining_seconds = EXCLUDED.remaining_seconds,
         did_finish = TRUE,
         submitted_at = NOW()`,
      [round.id, user.id, elapsedSeconds, remainingSeconds],
    );

    const playerCountQuery = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM multiplayer_room_players
       WHERE room_id = $1`,
      [room.id],
    );
    const submittedCountQuery = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM multiplayer_room_submissions
       WHERE round_id = $1`,
      [round.id],
    );

    const allSubmitted = submittedCountQuery.rows[0].count >= playerCountQuery.rows[0].count;

    if (allSubmitted) {
      await finalizeRoomRound(client, room, round, false);
    } else {
      await client.query(
        `UPDATE multiplayer_rooms
         SET updated_at = NOW()
         WHERE id = $1`,
        [room.id],
      );
    }

    await client.query('COMMIT');
    const snapshot = await readRoomByCode(code);
    res.json(snapshot);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('multiplayer room submit error', error);
    res.status(500).json({ error: 'room_submit_failed' });
  } finally {
    client.release();
  }
});

app.get('/api/multiplayer/stats', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (user.provider === 'guest') {
    res.json({
      stats: {
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        totalPlaySeconds: 0,
        bestElapsedSeconds: null,
        updatedAt: null,
      },
    });
    return;
  }

  try {
    const query = await pool.query(
      `SELECT *
       FROM user_multiplayer_stats
       WHERE user_id = $1
       LIMIT 1`,
      [user.id],
    );
    const row = query.rows[0];
    if (!row) {
      res.json({
        stats: {
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          totalPlaySeconds: 0,
          bestElapsedSeconds: null,
          updatedAt: null,
        },
      });
      return;
    }
    res.json({
      stats: {
        matchesPlayed: row.matches_played,
        wins: row.wins,
        losses: row.losses,
        totalPlaySeconds: row.total_play_seconds,
        bestElapsedSeconds: row.best_elapsed_seconds,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('multiplayer stats fetch error', error);
    res.status(500).json({ error: 'multiplayer_stats_fetch_failed' });
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
