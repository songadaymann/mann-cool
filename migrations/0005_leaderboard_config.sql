UPDATE games
SET leaderboard_enabled = 1,
    leaderboard_direction = CASE
      WHEN slug IN ('meelode', 'punkfling') THEN 'desc'
      ELSE 'asc'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE slug IN (
  'beepleblox', 'hell', 'meelode', 'penisvagina', 'punkfling',
  'punkmatch', 'punksinspace', 'sledding'
);
