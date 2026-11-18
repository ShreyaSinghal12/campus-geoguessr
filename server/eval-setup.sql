-- Pins the three rounds for one date.
-- Edit the three ids and the date, then run the file.

BEGIN;

DELETE FROM guesses
WHERE challenge_id IN (
  SELECT id FROM daily_challenges WHERE challenge_date = DATE '2026-11-19'
);

DELETE FROM daily_challenges
WHERE challenge_date = DATE '2026-11-19';

INSERT INTO daily_challenges (landmark_id, challenge_date, difficulty) VALUES
  (8, DATE '2026-11-18', 'easy'),
  (10, DATE '2026-11-18', 'medium'),
  (9, DATE '2026-11-18', 'hard');

COMMIT;