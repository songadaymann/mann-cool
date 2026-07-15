UPDATE games SET leaderboard_enabled = 1, leaderboard_direction = 'asc', updated_at = CURRENT_TIMESTAMP
WHERE slug IN ('beepleblox', 'punkfling');
