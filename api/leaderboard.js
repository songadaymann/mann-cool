import { Redis } from '@upstash/redis';

/**
 * Generic Leaderboard API
 *
 * Works for any game. Each game can have multiple variants (e.g., grid sizes, levels).
 *
 * Redis key format: leaderboard:{game}:{variant}
 *
 * GET /api/leaderboard?game=punkmatch&variant=4x4&limit=10
 * POST /api/leaderboard { game, variant, address, name, score, time, ... }
 */

function getLeaderboardKey(game, variant) {
  return `leaderboard:${game}:${variant || 'default'}`;
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify Redis is configured
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({
      error: 'Redis not configured'
    });
  }

  let redis;
  try {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  } catch (initError) {
    return res.status(500).json({
      error: 'Redis init failed',
      message: initError.message
    });
  }

  try {
    // GET - Fetch leaderboard
    if (req.method === 'GET') {
      const { game, variant, limit = '10' } = req.query;

      if (!game) {
        return res.status(400).json({ error: 'Missing game parameter' });
      }

      const key = getLeaderboardKey(game, variant);
      const limitNum = Math.min(parseInt(limit, 10) || 10, 100);

      // Get top scores (sorted set, lowest score = best)
      const entries = await redis.zrange(key, 0, limitNum - 1, { withScores: false });

      // Parse JSON entries
      const parsed = (entries || []).map((entry, index) => {
        try {
          const data = typeof entry === 'string' ? JSON.parse(entry) : entry;
          return { rank: index + 1, ...data };
        } catch {
          return null;
        }
      }).filter(Boolean);

      return res.status(200).json({
        success: true,
        game,
        variant: variant || 'default',
        entries: parsed
      });
    }

    // POST - Submit score
    if (req.method === 'POST') {
      const body = req.body || {};
      const { game, variant, address, name, score, ...extra } = body;

      // Validate required fields
      if (!game) {
        return res.status(400).json({ error: 'Missing game parameter' });
      }
      if (!name) {
        return res.status(400).json({ error: 'Missing name' });
      }
      if (score === undefined || score === null) {
        return res.status(400).json({ error: 'Missing score' });
      }

      // Validate address format if provided
      if (address && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({ error: 'Invalid wallet address' });
      }

      // Sanitize name (max 20 chars, safe characters only)
      const sanitizedName = String(name).slice(0, 20).replace(/[^a-zA-Z0-9 ._-]/g, '');

      const entry = {
        address: address || null,
        name: sanitizedName,
        score: Number(score),
        timestamp: Date.now(),
        ...extra // Allow game-specific extra fields (e.g., time, moves, level)
      };

      const key = getLeaderboardKey(game, variant);

      // Score determines ranking (lower = better for most games)
      // Games can pass their own score calculation
      const sortScore = Number(score);

      // Add to sorted set
      await redis.zadd(key, {
        score: sortScore,
        member: JSON.stringify(entry),
      });

      // Get player's rank
      const rank = await redis.zrank(key, JSON.stringify(entry));

      return res.status(200).json({
        success: true,
        game,
        variant: variant || 'default',
        entry,
        rank: rank !== null ? rank + 1 : null
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Leaderboard error:', error);
    return res.status(500).json({
      error: 'Server error',
      message: error.message
    });
  }
}
