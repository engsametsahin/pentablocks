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
