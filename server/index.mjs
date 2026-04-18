import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { parse as parseCookie, serialize as serializeCookie } from 'cookie';
import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import { pool, ensureSchema, closePool } from './db.mjs';

const app = express();

const API_PORT = Number(process.env.API_PORT ?? 8787);
const APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3020';
const APP_ORIGINS = process.env.APP_ORIGINS ?? '';
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? APP_ORIGIN;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? process.env.VITE_GOOGLE_CLIENT_ID ?? '';
const SESSION_COOKIE = 'pb_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const EMAIL_VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24;
const oauthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const MAX_LEVEL = 100;
const CHALLENGE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHALLENGE_CODE_LENGTH = 8;
const MATCH_START_DELAY_SECONDS = 5;
const ARENA_QUEUE_TTL_SECONDS = 90;
const ARENA_MATCH_TIMEOUT_SECONDS = 180;
const ARENA_MATCH_START_DELAY_SECONDS = 5;
const ARENA_ELO_K_PLACEMENT = 40;  // ilk 30 maç (placement)
const ARENA_ELO_K_STANDARD  = 32;  // 1000–1800
const ARENA_ELO_K_MASTER    = 16;  // 1800+
const ARENA_MAX_RATING_DIFF_INITIAL = 200;  // ilk 30sn
const ARENA_MAX_RATING_DIFF_RELAXED = 400;  // 30-60sn
// 60sn sonra herhangi biriyle eşleştir
const ARENA_BOTS_ENABLED = String(process.env.ARENA_BOTS_ENABLED ?? 'true').toLowerCase() !== 'false';
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
const SMTP_HOST = process.env.SMTP_HOST ?? '';
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE ?? '').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER ?? '';
const SMTP_PASS = process.env.SMTP_PASS ?? '';
const SMTP_FROM = process.env.SMTP_FROM ?? '';
const ARENA_BOT_PROFILES = [
  { key: 'spark', rating: 980, names: ['Spark Bot', 'Rookie Bot'] },
  { key: 'flame', rating: 1100, names: ['Flame Bot', 'Pulse Bot'] },
  { key: 'ember', rating: 1250, names: ['Ember Bot', 'Core Bot'] },
  { key: 'blaze', rating: 1425, names: ['Blaze Bot', 'Forge Bot'] },
  { key: 'storm', rating: 1600, names: ['Storm Bot', 'Volt Bot'] },
  { key: 'thunder', rating: 1780, names: ['Thunder Bot', 'Nova Bot'] },
  { key: 'legend', rating: 1980, names: ['Legend Bot', 'Titan Bot'] },
  { key: 'champion', rating: 2150, names: ['Champion Bot', 'Apex Bot'] },
];

const mailTransport = SMTP_HOST && SMTP_FROM
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    })
  : null;
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((value) => normalizeEmail(value))
    .filter(Boolean),
);
const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0),
);

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
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
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

function normalizeGuestDisplayName(input, fallback = 'Guest') {
  const base = normalizeDisplayName(input, fallback).replace(/\s*\(guest\)\s*$/i, '').trim();
  return normalizeDisplayName(`${base || 'Guest'} (Guest)`, 'Guest (Guest)');
}

function normalizeEmail(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;
  return value;
}

function normalizeLoginName(input) {
  if (typeof input !== 'string') return null;
  const value = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]+$/g, '');
  if (value.length < 3) return null;
  return value.slice(0, 24);
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

function buildEmailVerificationToken() {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

function buildEmailVerificationUrl(token) {
  const url = new URL(APP_PUBLIC_URL);
  url.searchParams.set('verifyEmail', token);
  return url.toString();
}

function isAdminUser(row) {
  if (!row) return false;
  if (ADMIN_USER_IDS.has(Number(row.id))) return true;
  const normalized = normalizeEmail(row.email);
  return normalized ? ADMIN_EMAILS.has(normalized) : false;
}

async function persistEmailVerificationToken(client, userId, email) {
  const { token, tokenHash } = buildEmailVerificationToken();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS);
  await client.query(
    `INSERT INTO email_verification_tokens (user_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, email, tokenHash, expiresAt],
  );
  return { token, expiresAt };
}

async function sendVerificationEmail({ email, displayName, token }) {
  const verificationUrl = buildEmailVerificationUrl(token);
  if (!mailTransport) {
    console.info(`[email verification disabled] ${email} -> ${verificationUrl}`);
    return false;
  }

  await mailTransport.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: 'Confirm your PentaBlocks account',
    text: `Hi ${displayName},\n\nConfirm your email for PentaBlocks:\n${verificationUrl}\n\nThis link expires in 24 hours.\n`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>Confirm your PentaBlocks account</h2>
        <p>Hi ${displayName},</p>
        <p>Click the button below to confirm your email address.</p>
        <p>
          <a href="${verificationUrl}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:12px;font-weight:700">
            Confirm Email
          </a>
        </p>
        <p>If the button does not work, open this link:</p>
        <p><a href="${verificationUrl}">${verificationUrl}</a></p>
        <p>This link expires in 24 hours.</p>
      </div>
    `,
  });

  return true;
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

function sanitizeRecentPuzzleFingerprints(input) {
  if (!Array.isArray(input)) return [];
  const unique = [];
  const seen = new Set();
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const value = item.trim().slice(0, 120);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  const MAX_HISTORY = 36;
  return unique.slice(-MAX_HISTORY);
}

function sanitizeProgress(input) {
  const safe = input && typeof input === 'object' ? input : {};
  const completedLevels = sanitizeCompletedLevels(safe.completedLevels);
  const bestTimes = sanitizeBestTimes(safe.bestTimes);
  const playerStats = sanitizePlayerStats(safe.playerStats);
  const lastLevel = Math.min(MAX_LEVEL, Math.max(1, toSafeInt(safe.lastLevel, 1)));
  const recentPuzzleFingerprints = sanitizeRecentPuzzleFingerprints(safe.recentPuzzleFingerprints);
  return { completedLevels, bestTimes, playerStats, lastLevel, recentPuzzleFingerprints };
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
  const didFinish = row.status === 'submitted' ? Boolean(row.did_win) : null;
  const placement = row.status === 'submitted'
    ? (row.did_win ? 1 : 2)
    : null;
  return {
    userId: row.user_id,
    displayName: row.display_name,
    provider: row.provider,
    joinedAt: row.joined_at,
    readyAt: row.ready_at,
    status,
    didWin: row.did_win,
    didFinish,
    placement,
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
    readyForRound: row.ready_for_round ?? 0,
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
    timeoutSeconds: row.timeout_seconds,
    deadlineAt: row.deadline_at,
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
  await client.query(
    `UPDATE multiplayer_room_players
     SET ready_for_round = 0
     WHERE room_id = $1`,
    [roomRow.id],
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
    await client.query(
      `UPDATE multiplayer_rooms
       SET updated_at = NOW()
       WHERE id = $1`,
      [roomRow.id],
    );
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

async function syncReadyNextRoundIfNeeded(code) {
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
    if (room.status !== 'in_progress' || room.current_round <= 0 || room.current_round >= room.total_rounds) {
      await client.query('COMMIT');
      return;
    }

    const currentRoundQuery = await client.query(
      `SELECT *
       FROM multiplayer_room_rounds
       WHERE room_id = $1 AND round_number = $2
       LIMIT 1
       FOR UPDATE`,
      [room.id, room.current_round],
    );
    if (currentRoundQuery.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }
    const currentRound = currentRoundQuery.rows[0];
    if (currentRound.status !== 'finished') {
      await client.query('COMMIT');
      return;
    }

    const targetRound = room.current_round + 1;
    const playerCountQuery = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM multiplayer_room_players
       WHERE room_id = $1`,
      [room.id],
    );
    const readyCountQuery = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM multiplayer_room_players
       WHERE room_id = $1
         AND ready_for_round >= $2`,
      [room.id, targetRound],
    );
    if (
      playerCountQuery.rows[0].count >= ROOM_MIN_PLAYERS_TO_START
      && readyCountQuery.rows[0].count >= playerCountQuery.rows[0].count
    ) {
      await startRoomRound(client, room, targetRound);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('multiplayer ready sync error', error);
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
    membershipTier: row.membership_tier ?? 'basic',
    emailVerifiedAt: row.email_verified_at,
    isAdmin: isAdminUser(row),
    arenaRating: row.arena_rating ?? 1000,
    arenaMatchesPlayed: row.arena_matches_played ?? 0,
    arenaWins: row.arena_wins ?? 0,
    arenaLosses: row.arena_losses ?? 0,
  };
}

function toProgressDto(row) {
  if (!row) {
    return {
      completedLevels: [],
      bestTimes: {},
      playerStats: sanitizePlayerStats({}),
      lastLevel: 1,
      recentPuzzleFingerprints: [],
      updatedAt: null,
    };
  }

  return {
    completedLevels: sanitizeCompletedLevels(row.completed_levels),
    bestTimes: sanitizeBestTimes(row.best_times),
    playerStats: sanitizePlayerStats(row.player_stats),
    lastLevel: Math.min(100, Math.max(1, toSafeInt(row.last_level, 1))),
    recentPuzzleFingerprints: sanitizeRecentPuzzleFingerprints(row.recent_puzzle_fingerprints),
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

async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (!isAdminUser(user)) {
    res.status(403).json({ error: 'admin_only_operation' });
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
      `INSERT INTO users (provider, google_sub, email, display_name, avatar_url, email_verified_at)
       VALUES ('google', $1, $2, $3, $4, CASE WHEN $2::text IS NOT NULL THEN NOW() ELSE NULL END)
       ON CONFLICT (google_sub) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         email_verified_at = CASE
           WHEN EXCLUDED.email IS NOT NULL THEN NOW()
           ELSE users.email_verified_at
         END,
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

app.post('/api/auth/nickname/register', async (req, res) => {
  const loginName = normalizeLoginName(req.body?.nickname);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const displayName = normalizeDisplayName(req.body?.nickname, 'Player');

  if (!loginName) {
    res.status(400).json({ error: 'invalid_nickname' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'password_too_short' });
    return;
  }

  const existing = await pool.query(
    `SELECT id FROM users WHERE lower(login_name) = lower($1) LIMIT 1`,
    [loginName],
  );
  if (existing.rows.length > 0) {
    res.status(409).json({ error: 'nickname_already_registered' });
    return;
  }

  const { salt, hash } = createPasswordDigest(password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const createdUser = await client.query(
      `INSERT INTO users (provider, login_name, display_name)
       VALUES ('nickname', $1, $2)
       RETURNING *`,
      [loginName, displayName],
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
    console.error('nickname register error', error);
    res.status(500).json({ error: 'nickname_register_failed' });
  } finally {
    client.release();
  }
});

app.post('/api/auth/nickname/login', async (req, res) => {
  const loginName = normalizeLoginName(req.body?.nickname);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!loginName || !password) {
    res.status(400).json({ error: 'invalid_credentials' });
    return;
  }

  try {
    const userQuery = await pool.query(
      `SELECT u.*, c.password_hash, c.password_salt
       FROM users u
       JOIN user_credentials c ON c.user_id = u.id
       WHERE lower(u.login_name) = lower($1) AND u.provider = 'nickname'
       LIMIT 1`,
      [loginName],
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
    console.error('nickname login error', error);
    res.status(500).json({ error: 'nickname_login_failed' });
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
    const verification = await persistEmailVerificationToken(client, user.id, email);
    await client.query('COMMIT');

    try {
      await sendVerificationEmail({
        email,
        displayName: user.display_name,
        token: verification.token,
      });
    } catch (mailError) {
      console.error('email verification send error', mailError);
    }

    const token = await createSession(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ user: toUserDto(user), verificationEmailSent: true });
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

app.post('/api/auth/email/resend-verification', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.provider !== 'email' || !user.email) {
    res.status(403).json({ error: 'email_verification_not_applicable' });
    return;
  }
  if (user.email_verified_at) {
    res.json({ ok: true, alreadyVerified: true });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const verification = await persistEmailVerificationToken(client, user.id, user.email);
    await client.query('COMMIT');

    try {
      await sendVerificationEmail({
        email: user.email,
        displayName: user.display_name,
        token: verification.token,
      });
    } catch (mailError) {
      console.error('email verification resend error', mailError);
    }

    res.json({ ok: true, alreadyVerified: false });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('email verification resend failed', error);
    res.status(500).json({ error: 'email_verification_resend_failed' });
  } finally {
    client.release();
  }
});

app.get('/api/auth/email/verify', async (req, res) => {
  const token = typeof req.query?.token === 'string' ? req.query.token : '';
  if (!token) {
    res.status(400).json({ error: 'missing_verification_token' });
    return;
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT evt.*, u.display_name
       FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'verification_token_invalid' });
      return;
    }

    const row = result.rows[0];
    if (row.used_at) {
      await client.query('ROLLBACK');
      res.json({ ok: true, alreadyVerified: true });
      return;
    }
    if (Date.parse(row.expires_at) < Date.now()) {
      await client.query('ROLLBACK');
      res.status(410).json({ error: 'verification_token_expired' });
      return;
    }

    const updatedUser = await client.query(
      `UPDATE users
       SET email_verified_at = COALESCE(email_verified_at, NOW()),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [row.user_id],
    );

    await client.query(
      `UPDATE email_verification_tokens
       SET used_at = NOW()
       WHERE id = $1`,
      [row.id],
    );

    await client.query('COMMIT');
    res.json({ ok: true, alreadyVerified: false, user: toUserDto(updatedUser.rows[0]) });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('email verify failed', error);
    res.status(500).json({ error: 'email_verification_failed' });
  } finally {
    client.release();
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

app.put('/api/auth/guest/nickname', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (user.provider !== 'guest') {
    res.status(403).json({ error: 'guest_only_operation' });
    return;
  }

  const nickname = normalizeGuestDisplayName(req.body?.nickname, user.display_name ?? 'Guest');
  try {
    const updated = await pool.query(
      `UPDATE users
       SET display_name = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [user.id, nickname],
    );
    res.json({ user: toUserDto(updated.rows[0]) });
  } catch (error) {
    console.error('guest nickname update error', error);
    res.status(500).json({ error: 'guest_nickname_update_failed' });
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

app.get('/api/admin/users', async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const queryText = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  try {
    const result = await pool.query(
      `SELECT id,
              provider,
              email,
              display_name,
              membership_tier,
              email_verified_at,
              created_at,
              updated_at
       FROM users
       WHERE $1 = ''
          OR lower(display_name) LIKE '%' || $1 || '%'
          OR lower(COALESCE(email, '')) LIKE '%' || $1 || '%'
       ORDER BY created_at DESC
       LIMIT 200`,
      [queryText],
    );

    res.json({
      users: result.rows.map((row) => ({
        ...toUserDto(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error('admin users fetch failed', error);
    res.status(500).json({ error: 'admin_users_fetch_failed' });
  }
});

app.put('/api/admin/users/:userId/membership', async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const userId = Number(req.params.userId);
  const membershipTier = typeof req.body?.membershipTier === 'string' ? req.body.membershipTier.trim().toLowerCase() : '';
  if (!Number.isFinite(userId) || userId <= 0) {
    res.status(400).json({ error: 'invalid_user_id' });
    return;
  }
  if (membershipTier !== 'basic' && membershipTier !== 'pro') {
    res.status(400).json({ error: 'invalid_membership_tier' });
    return;
  }

  try {
    const updated = await pool.query(
      `UPDATE users
       SET membership_tier = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, provider, email, display_name, membership_tier, email_verified_at, created_at, updated_at`,
      [userId, membershipTier],
    );

    if (updated.rows.length === 0) {
      res.status(404).json({ error: 'admin_user_not_found' });
      return;
    }

    res.json({
      user: {
        ...toUserDto(updated.rows[0]),
        createdAt: updated.rows[0].created_at,
        updatedAt: updated.rows[0].updated_at,
      },
    });
  } catch (error) {
    console.error('admin membership update failed', error);
    res.status(500).json({ error: 'admin_membership_update_failed' });
  }
});

app.put('/api/admin/users/membership/bulk', async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const membershipTier = typeof req.body?.membershipTier === 'string' ? req.body.membershipTier.trim().toLowerCase() : '';
  const userIds = Array.isArray(req.body?.userIds)
    ? req.body.userIds
        .map((value) => Number(value))
        .filter((value, index, arr) => Number.isFinite(value) && value > 0 && arr.indexOf(value) === index)
    : [];

  if (membershipTier !== 'basic' && membershipTier !== 'pro') {
    res.status(400).json({ error: 'invalid_membership_tier' });
    return;
  }
  if (userIds.length === 0) {
    res.status(400).json({ error: 'invalid_user_id' });
    return;
  }

  try {
    const updated = await pool.query(
      `UPDATE users
       SET membership_tier = $2,
           updated_at = NOW()
       WHERE id = ANY($1::bigint[])
       RETURNING id, provider, email, display_name, membership_tier, email_verified_at, created_at, updated_at`,
      [userIds, membershipTier],
    );

    res.json({
      users: updated.rows.map((row) => ({
        ...toUserDto(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error('admin bulk membership update failed', error);
    res.status(500).json({ error: 'admin_membership_update_failed' });
  }
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
      `INSERT INTO user_progress (user_id, completed_levels, best_times, player_stats, last_level, recent_puzzle_fingerprints, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         completed_levels = EXCLUDED.completed_levels,
         best_times = EXCLUDED.best_times,
         player_stats = EXCLUDED.player_stats,
         last_level = EXCLUDED.last_level,
         recent_puzzle_fingerprints = EXCLUDED.recent_puzzle_fingerprints,
         updated_at = NOW()
       RETURNING *`,
      [
        user.id,
        JSON.stringify(clean.completedLevels),
        JSON.stringify(clean.bestTimes),
        JSON.stringify(clean.playerStats),
        clean.lastLevel,
        JSON.stringify(clean.recentPuzzleFingerprints),
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
    await syncReadyNextRoundIfNeeded(code);
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

app.post('/api/multiplayer/rooms/:code/next', async (req, res) => {
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

    if (room.current_round >= room.total_rounds) {
      await client.query('ROLLBACK');
      const snapshot = await readRoomByCode(code);
      res.json(snapshot);
      return;
    }

    const currentRoundQuery = await client.query(
      `SELECT *
       FROM multiplayer_room_rounds
       WHERE room_id = $1 AND round_number = $2
       LIMIT 1
       FOR UPDATE`,
      [room.id, room.current_round],
    );
    if (currentRoundQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'room_round_not_found' });
      return;
    }
    const currentRound = currentRoundQuery.rows[0];
    if (currentRound.status !== 'finished') {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'room_round_not_finished' });
      return;
    }

    const targetRound = room.current_round + 1;
    await client.query(
      `UPDATE multiplayer_room_players
       SET ready_for_round = GREATEST(ready_for_round, $2)
       WHERE room_id = $1
         AND user_id = $3`,
      [room.id, targetRound, user.id],
    );

    const playerCountQuery = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM multiplayer_room_players
       WHERE room_id = $1`,
      [room.id],
    );
    const readyCountQuery = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM multiplayer_room_players
       WHERE room_id = $1
         AND ready_for_round >= $2`,
      [room.id, targetRound],
    );

    if (readyCountQuery.rows[0].count >= playerCountQuery.rows[0].count) {
      await startRoomRound(client, room, targetRound);
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
    console.error('multiplayer next round ready error', error);
    res.status(500).json({ error: 'room_next_round_failed' });
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
  const didFinishInput = req.body?.didFinish !== false;

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
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (round_id, user_id) DO UPDATE SET
         elapsed_seconds = EXCLUDED.elapsed_seconds,
         remaining_seconds = EXCLUDED.remaining_seconds,
         did_finish = EXCLUDED.did_finish,
         submitted_at = NOW()`,
      [round.id, user.id, elapsedSeconds, remainingSeconds, didFinishInput],
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

    const playerCount = playerCountQuery.rows[0].count;
    const submittedCount = submittedCountQuery.rows[0].count;
    const allSubmitted = submittedCount >= playerCount;
    const onePlayerLeftUnsubmitted = playerCount > 1 && submittedCount === (playerCount - 1);

    if (allSubmitted) {
      await finalizeRoomRound(client, room, round, false);
    } else if (onePlayerLeftUnsubmitted) {
      // If exactly one player is still unresolved, end the round immediately and mark that
      // last player as DNF so everyone can move to the next round without dead time.
      await finalizeRoomRound(client, room, round, true);
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

// ── Arena helpers ──────────────────────────────────────────────────────────────

/** Rating-based level selection for arena matches. */
function arenaLevelForRating(avgRating) {
  if (avgRating < 1100) return 10;   // Spark/Flame tier
  if (avgRating < 1300) return 25;   // Ember tier
  if (avgRating < 1500) return 40;   // Blaze tier
  if (avgRating < 1700) return 55;   // Thunder tier
  if (avgRating < 1900) return 68;   // Cyclone tier
  return 82;                          // Legend+ tier
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pickArenaBotProfile(userRating) {
  const sorted = [...ARENA_BOT_PROFILES].sort((a, b) => Math.abs(a.rating - userRating) - Math.abs(b.rating - userRating));
  const shortlist = sorted.slice(0, Math.min(4, sorted.length));
  return shortlist[Math.floor(Math.random() * shortlist.length)] ?? sorted[0];
}

function buildArenaBotDisplayName(profile) {
  const base = profile.names[Math.floor(Math.random() * profile.names.length)] ?? 'Arena Bot';
  return `${base} [BOT]`;
}

async function ensureArenaBotUser(client, profile) {
  const loginName = `arena-bot-${profile.key}`;
  const existing = await client.query(
    `SELECT id, arena_rating
     FROM users
     WHERE provider = 'bot'
       AND login_name = $1
     LIMIT 1`,
    [loginName],
  );
  if (existing.rows.length > 0) {
    return { id: Number(existing.rows[0].id), rating: Number(existing.rows[0].arena_rating ?? profile.rating) };
  }

  const created = await client.query(
    `INSERT INTO users
       (provider, login_name, display_name, membership_tier, arena_rating, arena_matches_played, arena_wins, arena_losses)
     VALUES
       ('bot', $1, $2, 'basic', $3, 0, 0, 0)
     RETURNING id, arena_rating`,
    [loginName, buildArenaBotDisplayName(profile), profile.rating],
  );
  return { id: Number(created.rows[0].id), rating: Number(created.rows[0].arena_rating ?? profile.rating) };
}

function simulateArenaBotResult({
  botRating,
  humanRating,
  timeoutSeconds,
  levelId,
  humanDidFinish,
}) {
  const ratingEdge = clampNumber((botRating - humanRating) / 450, -1.25, 1.25);
  const levelPressure = clampNumber((levelId - 1) / (MAX_LEVEL - 1), 0, 1);
  let finishChance = 0.74 + (ratingEdge * 0.14) - (levelPressure * 0.16);
  if (humanDidFinish === false) finishChance += 0.05;
  if (humanDidFinish === true) finishChance -= 0.03;
  finishChance = clampNumber(finishChance, 0.2, 0.96);

  const didFinish = Math.random() < finishChance;
  if (!didFinish) {
    return { didFinish: false, elapsedSeconds: null, remainingSeconds: null };
  }

  const speedBase = 0.58 - (ratingEdge * 0.12) + (levelPressure * 0.18);
  const speedJitter = 0.8 + (Math.random() * 0.45);
  const elapsedSeconds = clampNumber(
    Math.round(timeoutSeconds * speedBase * speedJitter),
    7,
    Math.max(7, timeoutSeconds - 1),
  );
  const remainingSeconds = Math.max(0, timeoutSeconds - elapsedSeconds);
  return { didFinish: true, elapsedSeconds, remainingSeconds };
}

async function createArenaMatchRecord(client, {
  playerAId,
  playerARating,
  playerBId,
  playerBRating,
}) {
  const avgRating = Math.round((playerARating + playerBRating) / 2);
  const levelId = arenaLevelForRating(avgRating);
  const puzzleSeed = buildPuzzleSeed();
  const [p1Id, p2Id, p1Rating, p2Rating] = Math.random() < 0.5
    ? [playerAId, playerBId, playerARating, playerBRating]
    : [playerBId, playerAId, playerBRating, playerARating];

  let matchCode;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = buildChallengeCode();
    const existing = await client.query(
      `SELECT id FROM arena_matches WHERE code = $1`,
      [candidate],
    );
    if (existing.rows.length === 0) {
      matchCode = candidate;
      break;
    }
  }
  if (!matchCode) {
    matchCode = crypto.randomBytes(6).toString('base64url').toUpperCase().slice(0, 8);
  }

  await client.query(
    `INSERT INTO arena_matches
       (code, level_id, puzzle_seed, player1_id, player2_id,
        player1_rating, player2_rating, status, start_at, timeout_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',
             NOW() + make_interval(secs => $8), $9)`,
    [
      matchCode,
      levelId,
      puzzleSeed,
      p1Id,
      p2Id,
      p1Rating,
      p2Rating,
      ARENA_MATCH_START_DELAY_SECONDS,
      ARENA_MATCH_TIMEOUT_SECONDS,
    ],
  );

  return matchCode;
}

/** Elo K-factor based on matches played and current rating. */
function arenaKFactor(matchesPlayed, rating) {
  if (matchesPlayed < 30) return ARENA_ELO_K_PLACEMENT;
  if (rating >= 1800) return ARENA_ELO_K_MASTER;
  return ARENA_ELO_K_STANDARD;
}

/**
 * Calculate new ratings after a match.
 * outcome: 1 = player1 wins, 0 = player2 wins, 0.5 = draw
 */
function calculateElo(r1, r2, outcome, mp1, mp2) {
  const expected1 = 1 / (1 + Math.pow(10, (r2 - r1) / 400));
  const expected2 = 1 - expected1;
  const k1 = arenaKFactor(mp1, r1);
  const k2 = arenaKFactor(mp2, r2);
  const change1 = Math.round(k1 * (outcome - expected1));
  const change2 = Math.round(k2 * ((1 - outcome) - expected2));
  return {
    newRating1: Math.max(100, r1 + change1),
    newRating2: Math.max(100, r2 + change2),
    change1,
    change2,
  };
}

function toArenaMatchDto(row, results = []) {
  return {
    code: row.code,
    levelId: row.level_id,
    puzzleSeed: row.puzzle_seed,
    player1: { id: Number(row.player1_id), displayName: row.p1_display_name ?? null, rating: row.player1_rating },
    player2: { id: Number(row.player2_id), displayName: row.p2_display_name ?? null, rating: row.player2_rating },
    status: row.status,
    startAt: row.start_at,
    timeoutSeconds: row.timeout_seconds,
    winnerId: row.winner_id ? Number(row.winner_id) : null,
    finishedAt: row.finished_at,
    results: results.map((r) => ({
      userId: Number(r.user_id),
      didFinish: r.did_finish,
      elapsedSeconds: r.elapsed_seconds,
      remainingSeconds: r.remaining_seconds,
      ratingBefore: r.rating_before,
      ratingAfter: r.rating_after,
      ratingChange: r.rating_change,
      submittedAt: r.submitted_at,
    })),
  };
}

async function fetchArenaMatch(code) {
  const matchQ = await pool.query(
    `SELECT m.*,
            u1.display_name AS p1_display_name,
            u2.display_name AS p2_display_name
     FROM arena_matches m
     JOIN users u1 ON u1.id = m.player1_id
     JOIN users u2 ON u2.id = m.player2_id
     WHERE m.code = $1`,
    [code],
  );
  if (matchQ.rows.length === 0) return null;
  const match = matchQ.rows[0];
  const resultsQ = await pool.query(
    `SELECT * FROM arena_match_results WHERE match_id = $1`,
    [match.id],
  );
  return toArenaMatchDto(match, resultsQ.rows);
}

/** Tries to pair the given user with a waiting opponent. Returns match code or null. */
async function runArenaMatchmaking(userId, userRating) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Guard: prevent joining queue while already in an active/pending match
    const activeMatchQ = await client.query(
      `SELECT code FROM arena_matches
       WHERE (player1_id = $1 OR player2_id = $1)
         AND status IN ('pending', 'active')
       LIMIT 1`,
      [userId],
    );
    if (activeMatchQ.rows.length > 0) {
      await client.query('COMMIT');
      return activeMatchQ.rows[0].code;
    }

    // Clean expired entries
    await client.query(`DELETE FROM arena_queue WHERE expires_at <= NOW()`);

    // Find best opponent (closest rating, not self, still in queue)
    const opponentQ = await client.query(
      `SELECT q.user_id, q.rating, q.joined_at,
              EXTRACT(EPOCH FROM (NOW() - q.joined_at))::int AS wait_seconds
       FROM arena_queue q
       WHERE q.user_id != $1
       ORDER BY ABS(q.rating - $2) ASC, q.joined_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [userId, userRating],
    );

    if (opponentQ.rows.length === 0) {
      if (ARENA_BOTS_ENABLED) {
        await client.query(`DELETE FROM arena_queue WHERE user_id = $1`, [userId]);
        const botProfile = pickArenaBotProfile(userRating);
        const bot = await ensureArenaBotUser(client, botProfile);
        const matchCode = await createArenaMatchRecord(client, {
          playerAId: userId,
          playerARating: userRating,
          playerBId: bot.id,
          playerBRating: bot.rating,
        });
        await client.query('COMMIT');
        return matchCode;
      }
      // No one waiting — join queue
      await client.query(
        `INSERT INTO arena_queue (user_id, rating, joined_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + make_interval(secs => $3))
         ON CONFLICT (user_id) DO UPDATE
           SET rating = $2, joined_at = NOW(),
               expires_at = NOW() + make_interval(secs => $3)`,
        [userId, userRating, ARENA_QUEUE_TTL_SECONDS],
      );
      await client.query('COMMIT');
      return null;
    }

    const opp = opponentQ.rows[0];
    const ratingDiff = Math.abs(userRating - Number(opp.rating));
    const waitSecs = Number(opp.wait_seconds ?? 0);

    // Rating diff threshold relaxes over time
    const maxDiff = waitSecs >= 60
      ? Infinity
      : waitSecs >= 30
        ? ARENA_MAX_RATING_DIFF_RELAXED
        : ARENA_MAX_RATING_DIFF_INITIAL;

    if (ratingDiff > maxDiff) {
      if (ARENA_BOTS_ENABLED) {
        await client.query(`DELETE FROM arena_queue WHERE user_id = $1`, [userId]);
        const botProfile = pickArenaBotProfile(userRating);
        const bot = await ensureArenaBotUser(client, botProfile);
        const matchCode = await createArenaMatchRecord(client, {
          playerAId: userId,
          playerARating: userRating,
          playerBId: bot.id,
          playerBRating: bot.rating,
        });
        await client.query('COMMIT');
        return matchCode;
      }
      // Not close enough yet — join queue and wait
      await client.query(
        `INSERT INTO arena_queue (user_id, rating, joined_at, expires_at)
         VALUES ($1, $2, NOW(), NOW() + make_interval(secs => $3))
         ON CONFLICT (user_id) DO UPDATE
           SET rating = $2, joined_at = NOW(),
               expires_at = NOW() + make_interval(secs => $3)`,
        [userId, userRating, ARENA_QUEUE_TTL_SECONDS],
      );
      await client.query('COMMIT');
      return null;
    }

    // Pair found — remove both from queue
    await client.query(
      `DELETE FROM arena_queue WHERE user_id IN ($1, $2)`,
      [userId, opp.user_id],
    );

    const matchCode = await createArenaMatchRecord(client, {
      playerAId: userId,
      playerARating: userRating,
      playerBId: Number(opp.user_id),
      playerBRating: Number(opp.rating),
    });

    await client.query('COMMIT');
    return matchCode;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Called when a player submits their result. Finalizes if both submitted or timeout. */
async function finalizeArenaMatchIfReady(matchCode) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const matchQ = await client.query(
      `SELECT m.*,
              u1.arena_matches_played AS p1_mp,
              u2.arena_matches_played AS p2_mp,
              u1.provider AS p1_provider,
              u2.provider AS p2_provider
       FROM arena_matches m
       JOIN users u1 ON u1.id = m.player1_id
       JOIN users u2 ON u2.id = m.player2_id
       WHERE m.code = $1 AND m.status = 'active'
       LIMIT 1 FOR UPDATE`,
      [matchCode],
    );
    if (matchQ.rows.length === 0) { await client.query('COMMIT'); return; }
    const match = matchQ.rows[0];

    let resultsQ = await client.query(
      `SELECT * FROM arena_match_results WHERE match_id = $1`,
      [match.id],
    );

    const p1IsBot = match.p1_provider === 'bot';
    const p2IsBot = match.p2_provider === 'bot';
    const botUserId = p1IsBot ? Number(match.player1_id) : (p2IsBot ? Number(match.player2_id) : null);
    const humanUserId = p1IsBot ? Number(match.player2_id) : (p2IsBot ? Number(match.player1_id) : null);

    if (botUserId && humanUserId) {
      const hasBotResult = resultsQ.rows.some((r) => Number(r.user_id) === botUserId);
      if (!hasBotResult) {
        const humanResult = resultsQ.rows.find((r) => Number(r.user_id) === humanUserId) ?? null;
        const botRating = botUserId === Number(match.player1_id)
          ? Number(match.player1_rating)
          : Number(match.player2_rating);
        const humanRating = humanUserId === Number(match.player1_id)
          ? Number(match.player1_rating)
          : Number(match.player2_rating);
        const simulated = simulateArenaBotResult({
          botRating,
          humanRating,
          timeoutSeconds: Number(match.timeout_seconds),
          levelId: Number(match.level_id),
          humanDidFinish: humanResult ? Boolean(humanResult.did_finish) : null,
        });

        await client.query(
          `INSERT INTO arena_match_results
             (match_id, user_id, did_finish, elapsed_seconds, remaining_seconds,
              rating_before, rating_after, rating_change, submitted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$6,0,NOW())
           ON CONFLICT (match_id, user_id) DO NOTHING`,
          [
            match.id,
            botUserId,
            simulated.didFinish,
            simulated.elapsedSeconds,
            simulated.remainingSeconds,
            botRating,
          ],
        );
        resultsQ = await client.query(
          `SELECT * FROM arena_match_results WHERE match_id = $1`,
          [match.id],
        );
      }
    }

    const bothSubmitted = resultsQ.rows.length === 2;
    const timedOut = new Date(match.start_at).getTime() + match.timeout_seconds * 1000 < Date.now();

    if (!bothSubmitted && !timedOut) { await client.query('COMMIT'); return; }

    // Determine winner
    const r1 = resultsQ.rows.find((r) => Number(r.user_id) === Number(match.player1_id));
    const r2 = resultsQ.rows.find((r) => Number(r.user_id) === Number(match.player2_id));

    let winnerId = null;
    let eloOutcome = 0.5; // default draw

    const finish1 = r1?.did_finish ?? false;
    const finish2 = r2?.did_finish ?? false;

    if (finish1 && !finish2) {
      winnerId = Number(match.player1_id);
      eloOutcome = 1;
    } else if (!finish1 && finish2) {
      winnerId = Number(match.player2_id);
      eloOutcome = 0;
    } else if (finish1 && finish2) {
      // Both finished — faster wins
      if ((r1.elapsed_seconds ?? 99999) < (r2.elapsed_seconds ?? 99999)) {
        winnerId = Number(match.player1_id);
        eloOutcome = 1;
      } else if ((r2.elapsed_seconds ?? 99999) < (r1.elapsed_seconds ?? 99999)) {
        winnerId = Number(match.player2_id);
        eloOutcome = 0;
      }
      // exact tie → draw (eloOutcome stays 0.5)
    }
    // both DNF → draw

    // Calculate Elo
    const elo = calculateElo(
      match.player1_rating,
      match.player2_rating,
      eloOutcome,
      match.p1_mp ?? 0,
      match.p2_mp ?? 0,
    );

    // Update player1 (skip permanent bot profile progression)
    if (!p1IsBot) {
      await client.query(
        `UPDATE users
         SET arena_rating = $2,
             arena_matches_played = arena_matches_played + 1,
             arena_wins  = arena_wins  + $3,
             arena_losses = arena_losses + $4
         WHERE id = $1`,
        [match.player1_id, elo.newRating1,
         winnerId === Number(match.player1_id) ? 1 : 0,
         winnerId === Number(match.player2_id) ? 1 : 0],
      );
    }
    // Update player2 (skip permanent bot profile progression)
    if (!p2IsBot) {
      await client.query(
        `UPDATE users
         SET arena_rating = $2,
             arena_matches_played = arena_matches_played + 1,
             arena_wins  = arena_wins  + $3,
             arena_losses = arena_losses + $4
         WHERE id = $1`,
        [match.player2_id, elo.newRating2,
         winnerId === Number(match.player2_id) ? 1 : 0,
         winnerId === Number(match.player1_id) ? 1 : 0],
      );
    }

    // Upsert results with rating info (in case of timeout DNF, create missing rows)
    const upsertResult = async (uid, ratingBefore, ratingAfter, ratingChange) => {
      await client.query(
        `INSERT INTO arena_match_results
           (match_id, user_id, did_finish, elapsed_seconds, remaining_seconds,
            rating_before, rating_after, rating_change, submitted_at)
         VALUES ($1,$2,FALSE,NULL,NULL,$3,$4,$5,NOW())
         ON CONFLICT (match_id, user_id) DO UPDATE
           SET rating_before = $3,
               rating_after  = $4,
               rating_change = $5`,
        [match.id, uid, ratingBefore, ratingAfter, ratingChange],
      );
    };
    const p1RatingAfter = p1IsBot ? Number(match.player1_rating) : elo.newRating1;
    const p1RatingChange = p1IsBot ? 0 : elo.change1;
    const p2RatingAfter = p2IsBot ? Number(match.player2_rating) : elo.newRating2;
    const p2RatingChange = p2IsBot ? 0 : elo.change2;
    await upsertResult(match.player1_id, match.player1_rating, p1RatingAfter, p1RatingChange);
    await upsertResult(match.player2_id, match.player2_rating, p2RatingAfter, p2RatingChange);

    // Finalize match
    await client.query(
      `UPDATE arena_matches
       SET status = 'finished', winner_id = $2, finished_at = NOW()
       WHERE id = $1`,
      [match.id, winnerId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('arena finalize error', err);
  } finally {
    client.release();
  }
}

// ── Arena endpoints ────────────────────────────────────────────────────────────

/** GET /api/arena/me — kendi arena profili */
app.get('/api/arena/me', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.json({
    rating: user.arena_rating ?? 1000,
    matchesPlayed: user.arena_matches_played ?? 0,
    wins: user.arena_wins ?? 0,
    losses: user.arena_losses ?? 0,
  });
});

/** POST /api/arena/queue/join — kuyruğa gir, eşleşince match code döner */
app.post('/api/arena/queue/join', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  // Guest'ler ranked oynayamaz
  if (user.provider === 'guest') {
    res.status(403).json({ error: 'guests_cannot_play_arena' });
    return;
  }

  try {
    const matchCode = await runArenaMatchmaking(Number(user.id), user.arena_rating ?? 1000);
    if (matchCode) {
      // Activate match
      await pool.query(
        `UPDATE arena_matches SET status = 'active' WHERE code = $1 AND status = 'pending'`,
        [matchCode],
      );
      res.json({ status: 'matched', matchCode });
    } else {
      res.json({ status: 'waiting' });
    }
  } catch (err) {
    console.error('arena queue join error', err);
    res.status(500).json({ error: 'arena_queue_join_failed' });
  }
});

/** DELETE /api/arena/queue/leave — kuyruktan çık */
app.delete('/api/arena/queue/leave', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    await pool.query(`DELETE FROM arena_queue WHERE user_id = $1`, [user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('arena queue leave error', err);
    res.status(500).json({ error: 'arena_queue_leave_failed' });
  }
});

/** GET /api/arena/queue/status — kuyruk durumu (polling için) */
app.get('/api/arena/queue/status', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    // Check if user was already matched (pending/active match)
    const matchQ = await pool.query(
      `SELECT code FROM arena_matches
       WHERE (player1_id = $1 OR player2_id = $1)
         AND status IN ('pending', 'active')
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id],
    );
    if (matchQ.rows.length > 0) {
      res.json({ status: 'matched', matchCode: matchQ.rows[0].code });
      return;
    }
    // Check if still in queue
    const queueQ = await pool.query(
      `SELECT joined_at, expires_at FROM arena_queue WHERE user_id = $1`,
      [user.id],
    );
    if (queueQ.rows.length > 0) {
      const row = queueQ.rows[0];
      const waitSeconds = Math.round((Date.now() - new Date(row.joined_at).getTime()) / 1000);
      res.json({ status: 'waiting', waitSeconds });
    } else {
      res.json({ status: 'idle' });
    }
  } catch (err) {
    console.error('arena queue status error', err);
    res.status(500).json({ error: 'arena_queue_status_failed' });
  }
});

/** GET /api/arena/match/:code — maç bilgisi */
app.get('/api/arena/match/:code', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    // Trigger timeout-based finalization on every poll so abandoned matches resolve.
    await finalizeArenaMatchIfReady(req.params.code);
    const dto = await fetchArenaMatch(req.params.code);
    if (!dto) { res.status(404).json({ error: 'arena_match_not_found' }); return; }
    // Only players can see the match
    if (dto.player1.id !== Number(user.id) && dto.player2.id !== Number(user.id)) {
      res.status(403).json({ error: 'arena_match_forbidden' }); return;
    }
    res.json({ match: dto });
  } catch (err) {
    console.error('arena match fetch error', err);
    res.status(500).json({ error: 'arena_match_fetch_failed' });
  }
});

/** POST /api/arena/match/:code/submit — sonuç gönder */
app.post('/api/arena/match/:code/submit', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const { didFinish, elapsedSeconds, remainingSeconds } = req.body ?? {};

  try {
    const matchQ = await pool.query(
      `SELECT * FROM arena_matches WHERE code = $1 LIMIT 1`,
      [req.params.code],
    );
    if (matchQ.rows.length === 0) {
      res.status(404).json({ error: 'arena_match_not_found' }); return;
    }
    const match = matchQ.rows[0];
    const userId = Number(user.id);
    if (Number(match.player1_id) !== userId && Number(match.player2_id) !== userId) {
      res.status(403).json({ error: 'arena_match_forbidden' }); return;
    }
    if (match.status !== 'active') {
      res.status(409).json({ error: 'arena_match_not_active' }); return;
    }

    const myRating = Number(match.player1_id) === userId ? match.player1_rating : match.player2_rating;

    await pool.query(
      `INSERT INTO arena_match_results
         (match_id, user_id, did_finish, elapsed_seconds, remaining_seconds,
          rating_before, rating_after, rating_change, submitted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$6,0,NOW())
       ON CONFLICT (match_id, user_id) DO NOTHING`,
      [match.id, userId, !!didFinish,
       typeof elapsedSeconds === 'number' ? elapsedSeconds : null,
       typeof remainingSeconds === 'number' ? remainingSeconds : null,
       myRating],
    );

    await finalizeArenaMatchIfReady(req.params.code);

    const dto = await fetchArenaMatch(req.params.code);
    res.json({ match: dto });
  } catch (err) {
    console.error('arena match submit error', err);
    res.status(500).json({ error: 'arena_match_submit_failed' });
  }
});

/** GET /api/arena/leaderboard — top 50 */
app.get('/api/arena/leaderboard', async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT id, display_name, arena_rating, arena_matches_played, arena_wins, arena_losses
       FROM users
       WHERE arena_matches_played >= 3
         AND provider <> 'bot'
       ORDER BY arena_rating DESC, arena_wins DESC
       LIMIT 50`,
    );
    res.json({
      leaderboard: q.rows.map((row, i) => ({
        rank: i + 1,
        userId: Number(row.id),
        displayName: row.display_name,
        rating: row.arena_rating,
        matchesPlayed: row.arena_matches_played,
        wins: row.arena_wins,
        losses: row.arena_losses,
      })),
    });
  } catch (err) {
    console.error('arena leaderboard error', err);
    res.status(500).json({ error: 'arena_leaderboard_failed' });
  }
});

/** GET /api/arena/history — son 20 maç */
app.get('/api/arena/history', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const q = await pool.query(
      `SELECT m.code, m.level_id, m.status, m.winner_id, m.created_at, m.finished_at,
              u1.display_name AS p1_name, u2.display_name AS p2_name,
              m.player1_id, m.player2_id, m.player1_rating, m.player2_rating,
              r.rating_before, r.rating_after, r.rating_change,
              r.did_finish, r.elapsed_seconds
       FROM arena_matches m
       JOIN users u1 ON u1.id = m.player1_id
       JOIN users u2 ON u2.id = m.player2_id
       LEFT JOIN arena_match_results r ON r.match_id = m.id AND r.user_id = $1
       WHERE (m.player1_id = $1 OR m.player2_id = $1)
         AND m.status = 'finished'
       ORDER BY m.finished_at DESC
       LIMIT 20`,
      [user.id],
    );
    res.json({
      history: q.rows.map((row) => {
        const isP1 = Number(row.player1_id) === Number(user.id);
        const opponent = { displayName: isP1 ? row.p2_name : row.p1_name };
        return {
          code: row.code,
          levelId: row.level_id,
          opponentName: opponent.displayName,
          myRatingBefore: row.rating_before,
          myRatingAfter: row.rating_after,
          ratingChange: row.rating_change ?? 0,
          didWin: Number(row.winner_id) === Number(user.id),
          didFinish: row.did_finish,
          elapsedSeconds: row.elapsed_seconds,
          finishedAt: row.finished_at,
        };
      }),
    });
  } catch (err) {
    console.error('arena history error', err);
    res.status(500).json({ error: 'arena_history_failed' });
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
