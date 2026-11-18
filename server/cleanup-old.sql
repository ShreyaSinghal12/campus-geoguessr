-- Removes the September seed data. Anything uploaded through the admin
-- panel has a /uploads/ path and is kept; the old rows point at expired
-- Google URLs and go.

BEGIN;

DELETE FROM guesses
WHERE challenge_id IN (
  SELECT dc.id
  FROM daily_challenges dc
  JOIN landmarks l ON l.id = dc.landmark_id
  WHERE l.photo_url NOT LIKE '/uploads/%'
);

DELETE FROM daily_challenges
WHERE landmark_id IN (
  SELECT id FROM landmarks WHERE photo_url NOT LIKE '/uploads/%'
);

DELETE FROM landmarks
WHERE photo_url NOT LIKE '/uploads/%';

COMMIT;