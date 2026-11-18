BEGIN;

-- Difficulty tier a landmark belongs to.
ALTER TABLE landmarks
  ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE landmarks DROP CONSTRAINT IF EXISTS landmarks_difficulty_check;
ALTER TABLE landmarks ADD CONSTRAINT landmarks_difficulty_check
  CHECK (difficulty IN ('easy', 'medium', 'hard'));

-- Three challenges a day, one per tier.
ALTER TABLE daily_challenges
  ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';

ALTER TABLE daily_challenges DROP CONSTRAINT IF EXISTS daily_challenges_difficulty_check;
ALTER TABLE daily_challenges ADD CONSTRAINT daily_challenges_difficulty_check
  CHECK (difficulty IN ('easy', 'medium', 'hard'));

-- The old one-challenge-per-date rule must go, replaced by one per tier.
ALTER TABLE daily_challenges DROP CONSTRAINT IF EXISTS daily_challenges_challenge_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS challenges_one_per_tier_per_day
  ON daily_challenges (challenge_date, difficulty);

COMMIT;