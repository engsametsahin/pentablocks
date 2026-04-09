CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  google_sub TEXT UNIQUE,
  email TEXT,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
      AND con.conname = 'users_provider_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_provider_check CHECK (provider IN ('guest', 'google', 'email'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_ci
  ON users ((lower(email)))
  WHERE email IS NOT NULL;

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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  status TEXT NOT NULL DEFAULT 'joined',
  did_win BOOLEAN,
  elapsed_seconds INTEGER,
  remaining_seconds INTEGER,
  submitted_at TIMESTAMPTZ,
  PRIMARY KEY (challenge_id, user_id)
);

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
