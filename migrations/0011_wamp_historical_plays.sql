-- Audited pre-counter WAMP history; see docs/wamp-play-history.md.
-- A separate source preserves every live increment, including concurrent posts.
INSERT INTO games (slug, title, status, leaderboard_enabled, leaderboard_direction)
VALUES ('wamp', 'WAMP', 'hidden', 0, 'desc')
ON CONFLICT(slug) DO NOTHING;

INSERT INTO play_totals (slug, source, play_count)
VALUES ('wamp', 'history-before-2026-10-17', 66585)
ON CONFLICT(slug, source) DO NOTHING;
