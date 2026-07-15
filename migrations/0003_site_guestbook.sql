INSERT INTO games (slug, title, status, leaderboard_enabled, leaderboard_direction)
VALUES ('mann-cool', 'mann.cool', 'hidden', 0, 'desc')
ON CONFLICT(slug) DO NOTHING;
