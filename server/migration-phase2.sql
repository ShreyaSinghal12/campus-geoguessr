-- Phase 2 migration: accounts, per-user attempts, streak support.
-- Safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Phase 1 guesses were made before accounts existed, so this column is
-- nullable. Those rows stay as anonymous historical attempts.
ALTER TABLE guesses
  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- FR-15: one scored attempt per user per challenge.
-- NULLs are never equal in a unique index, so the legacy anonymous rows
-- do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS guesses_one_per_user_per_challenge
  ON guesses (user_id, challenge_id)
  WHERE user_id IS NOT NULL;

-- Supports the leaderboard aggregation and the streak query.
CREATE INDEX IF NOT EXISTS guesses_user_idx ON guesses (user_id);

-- Supports least-recently-used landmark selection in the scheduler.
CREATE INDEX IF NOT EXISTS challenges_landmark_idx ON daily_challenges (landmark_id);

COMMIT;