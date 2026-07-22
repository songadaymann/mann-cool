INSERT INTO games (
  slug, title, status, leaderboard_enabled, leaderboard_direction, created_at, updated_at
)
SELECT
  'jimothy', title, status, leaderboard_enabled, leaderboard_direction, created_at, CURRENT_TIMESTAMP
FROM games
WHERE slug = 'jimothy-vs-flock-inc'
ON CONFLICT(slug) DO UPDATE SET
  title = excluded.title,
  status = excluded.status,
  leaderboard_enabled = excluded.leaderboard_enabled,
  leaderboard_direction = excluded.leaderboard_direction,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO play_totals (slug, source, play_count, updated_at)
SELECT 'jimothy', source, play_count, updated_at
FROM play_totals
WHERE slug = 'jimothy-vs-flock-inc'
ON CONFLICT(slug, source) DO UPDATE SET
  play_count = play_totals.play_count + excluded.play_count,
  updated_at = MAX(play_totals.updated_at, excluded.updated_at);

UPDATE guestbook_entries
SET slug = 'jimothy'
WHERE slug = 'jimothy-vs-flock-inc';

UPDATE leaderboard_entries
SET slug = 'jimothy'
WHERE slug = 'jimothy-vs-flock-inc';

UPDATE community_levels
SET slug = 'jimothy'
WHERE slug = 'jimothy-vs-flock-inc';

DELETE FROM play_totals
WHERE slug = 'jimothy-vs-flock-inc';

DELETE FROM games
WHERE slug = 'jimothy-vs-flock-inc';
