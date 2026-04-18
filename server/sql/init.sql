CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  google_sub TEXT UNIQUE,
  email TEXT,
  login_name TEXT,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  membership_tier TEXT NOT NULL DEFAULT 'basic',
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS membership_tier TEXT NOT NULL DEFAULT 'basic';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_name TEXT;

DO $$
DECLARE
  chk_name TEXT;
BEGIN
  SELECT con.conname
  INTO chk_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'users'
    AND nsp.nspname = current_schema()
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%provider%';

  IF chk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', chk_name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'users'
      AND nsp.nspname = current_schema()
      AND con.conname = 'users_membership_tier_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_membership_tier_check CHECK (membership_tier IN ('basic', 'pro'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'users'
      AND nsp.nspname = current_schema()
      AND con.conname = 'users_provider_check'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_provider_check;
  END IF;

  ALTER TABLE users
    ADD CONSTRAINT users_provider_check CHECK (provider IN ('guest', 'google', 'email', 'nickname'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_ci
  ON users ((lower(email)))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_login_name_unique_ci
  ON users ((lower(login_name)))
  WHERE login_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS user_progress (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  completed_levels JSONB NOT NULL DEFAULT '[]'::jsonb,
  best_times JSONB NOT NULL DEFAULT '{}'::jsonb,
  player_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_level INTEGER NOT NULL DEFAULT 1,
  recent_puzzle_fingerprints JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_progress
  ADD COLUMN IF NOT EXISTS recent_puzzle_fingerprints JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_idx
  ON email_verification_tokens (expires_at);

CREATE TABLE IF NOT EXISTS multiplayer_challenges (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level_id INTEGER NOT NULL,
  puzzle_seed TEXT NOT NULL DEFAULT '',
  is_ranked BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'open',
  start_at TIMESTAMPTZ,
  winner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

ALTER TABLE multiplayer_challenges
  ADD COLUMN IF NOT EXISTS is_ranked BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE multiplayer_challenges
  ADD COLUMN IF NOT EXISTS puzzle_seed TEXT NOT NULL DEFAULT '';
ALTER TABLE multiplayer_challenges
  ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;
ALTER TABLE multiplayer_challenges
  ADD COLUMN IF NOT EXISTS winner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE multiplayer_challenges
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'multiplayer_challenges'
      AND nsp.nspname = current_schema()
      AND con.conname = 'multiplayer_challenges_status_check'
  ) THEN
    ALTER TABLE multiplayer_challenges
      ADD CONSTRAINT multiplayer_challenges_status_check CHECK (status IN ('open', 'closed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS multiplayer_challenges_creator_idx
  ON multiplayer_challenges (created_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS multiplayer_challenges_status_idx
  ON multiplayer_challenges (status, created_at DESC);

CREATE TABLE IF NOT EXISTS multiplayer_challenge_players (
  challenge_id BIGINT NOT NULL REFERENCES multiplayer_challenges(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'joined',
  did_win BOOLEAN,
  elapsed_seconds INTEGER,
  remaining_seconds INTEGER,
  submitted_at TIMESTAMPTZ,
  PRIMARY KEY (challenge_id, user_id)
);

ALTER TABLE multiplayer_challenge_players
  ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'multiplayer_challenge_players'
      AND nsp.nspname = current_schema()
      AND con.conname = 'multiplayer_challenge_players_status_check'
  ) THEN
    ALTER TABLE multiplayer_challenge_players
      ADD CONSTRAINT multiplayer_challenge_players_status_check CHECK (status IN ('joined', 'submitted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS multiplayer_challenge_players_user_idx
  ON multiplayer_challenge_players (user_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS user_multiplayer_stats (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  matches_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  total_play_seconds INTEGER NOT NULL DEFAULT 0,
  best_elapsed_seconds INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS multiplayer_rooms (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_by_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level_id INTEGER NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'moderate',
  total_rounds INTEGER NOT NULL DEFAULT 3,
  max_players INTEGER NOT NULL DEFAULT 8,
  is_ranked BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'open',
  current_round INTEGER NOT NULL DEFAULT 0,
  champion_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

ALTER TABLE multiplayer_rooms
  ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'moderate';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'multiplayer_rooms'
      AND nsp.nspname = current_schema()
      AND con.conname = 'multiplayer_rooms_status_check'
  ) THEN
    ALTER TABLE multiplayer_rooms
      ADD CONSTRAINT multiplayer_rooms_status_check CHECK (status IN ('open', 'in_progress', 'finished'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'multiplayer_rooms'
      AND nsp.nspname = current_schema()
      AND con.conname = 'multiplayer_rooms_difficulty_check'
  ) THEN
    ALTER TABLE multiplayer_rooms
      ADD CONSTRAINT multiplayer_rooms_difficulty_check CHECK (difficulty IN ('easy', 'moderate', 'hard', 'very_hard'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS multiplayer_rooms_status_idx
  ON multiplayer_rooms (status, created_at DESC);

CREATE TABLE IF NOT EXISTS multiplayer_room_players (
  room_id BIGINT NOT NULL REFERENCES multiplayer_rooms(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_points INTEGER NOT NULL DEFAULT 0,
  ready_for_round INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);

ALTER TABLE multiplayer_room_players
  ADD COLUMN IF NOT EXISTS ready_for_round INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS multiplayer_room_rounds (
  id BIGSERIAL PRIMARY KEY,
  room_id BIGINT NOT NULL REFERENCES multiplayer_rooms(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  puzzle_seed TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  timeout_seconds INTEGER NOT NULL DEFAULT 240,
  deadline_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '240 seconds'),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  UNIQUE (room_id, round_number)
);

ALTER TABLE multiplayer_room_rounds
  ADD COLUMN IF NOT EXISTS timeout_seconds INTEGER NOT NULL DEFAULT 240;
ALTER TABLE multiplayer_room_rounds
  ADD COLUMN IF NOT EXISTS deadline_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '240 seconds');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'multiplayer_room_rounds'
      AND nsp.nspname = current_schema()
      AND con.conname = 'multiplayer_room_rounds_status_check'
  ) THEN
    ALTER TABLE multiplayer_room_rounds
      ADD CONSTRAINT multiplayer_room_rounds_status_check CHECK (status IN ('active', 'finished'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS multiplayer_room_rounds_room_idx
  ON multiplayer_room_rounds (room_id, round_number DESC);

CREATE TABLE IF NOT EXISTS multiplayer_room_submissions (
  round_id BIGINT NOT NULL REFERENCES multiplayer_room_rounds(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  elapsed_seconds INTEGER NOT NULL,
  remaining_seconds INTEGER NOT NULL,
  did_finish BOOLEAN NOT NULL DEFAULT TRUE,
  points_awarded INTEGER NOT NULL DEFAULT 0,
  placement INTEGER,
  PRIMARY KEY (round_id, user_id)
);

ALTER TABLE multiplayer_room_submissions
  ADD COLUMN IF NOT EXISTS did_finish BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS multiplayer_room_submissions_round_idx
  ON multiplayer_room_submissions (round_id, placement ASC NULLS LAST, elapsed_seconds ASC);

-- ── Arena Mode ────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS arena_rating INT NOT NULL DEFAULT 1000;
ALTER TABLE users ADD COLUMN IF NOT EXISTS arena_matches_played INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS arena_wins INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS arena_losses INT NOT NULL DEFAULT 0;

-- Matchmaking queue (one slot per user)
CREATE TABLE IF NOT EXISTS arena_queue (
  user_id    BIGINT NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rating     INT NOT NULL,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 seconds')
);

-- Completed and in-progress 1v1 arena matches
CREATE TABLE IF NOT EXISTS arena_matches (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  level_id        INT NOT NULL,
  puzzle_seed     TEXT NOT NULL,
  player1_id      BIGINT NOT NULL REFERENCES users(id),
  player2_id      BIGINT NOT NULL REFERENCES users(id),
  player1_rating  INT NOT NULL,
  player2_rating  INT NOT NULL,
  winner_id       BIGINT REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'pending',
  start_at        TIMESTAMPTZ,
  timeout_seconds INT NOT NULL DEFAULT 180,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'arena_matches'
      AND nsp.nspname = current_schema()
      AND con.conname = 'arena_matches_status_check'
  ) THEN
    ALTER TABLE arena_matches
      ADD CONSTRAINT arena_matches_status_check
      CHECK (status IN ('pending', 'active', 'finished', 'aborted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS arena_matches_player1_idx ON arena_matches (player1_id, created_at DESC);
CREATE INDEX IF NOT EXISTS arena_matches_player2_idx ON arena_matches (player2_id, created_at DESC);

-- Per-player results inside each arena match
CREATE TABLE IF NOT EXISTS arena_match_results (
  match_id          BIGINT NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  did_finish        BOOLEAN NOT NULL DEFAULT FALSE,
  elapsed_seconds   INT,
  remaining_seconds INT,
  rating_before     INT NOT NULL,
  rating_after      INT NOT NULL,
  rating_change     INT NOT NULL DEFAULT 0,
  submitted_at      TIMESTAMPTZ,
  PRIMARY KEY (match_id, user_id)
);
