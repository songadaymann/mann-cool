import { Redis } from '@upstash/redis';

/**
 * Stupid Clicker - Admin Reset API
 *
 * Resets off-chain click data for testing purposes.
 * NEVER use in production once game is live!
 *
 * POST /api/clickstr-admin-reset
 * {
 *   "secret": "YOUR_ADMIN_SECRET",
 *   "address": "0x..." // optional - if omitted, resets ALL data
 * }
 */

// Redis keys (must match clickstr.js)
const CLICKS_KEY = (addr) => `clickstr:clicks:${addr.toLowerCase()}`;
const LEADERBOARD_KEY = 'clickstr:leaderboard';
const ONCHAIN_LEADERBOARD_KEY = 'clickstr:onchain-leaderboard';
const MILESTONES_KEY = (addr) => `clickstr:milestones:${addr.toLowerCase()}`;
const ACHIEVEMENTS_KEY = (addr) => `clickstr:achievements:${addr.toLowerCase()}`;
const ELIGIBLE_KEY = 'clickstr:nft-eligible';
const GLOBAL_CLICKS_KEY = 'clickstr:global-clicks';
const GLOBAL_MILESTONES_KEY = 'clickstr:global-milestones';
const STREAK_KEY = (addr) => `clickstr:streak:${addr.toLowerCase()}`;
const TIME_CLICKS_KEY = (addr) => `clickstr:time-clicks:${addr.toLowerCase()}`;
const HUMAN_SESSION_KEY = (addr) => `clickstr:human-session:${addr.toLowerCase()}`;

function validateAddress(address) {
  return address && /^0x[a-fA-F0-9]{40}$/.test(address);
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check admin secret
  const adminSecret = process.env.CLICKSTR_ADMIN_SECRET;
  if (!adminSecret) {
    return res.status(500).json({ error: 'Admin secret not configured' });
  }

  const { secret, address } = req.body || {};

  if (secret !== adminSecret) {
    return res.status(401).json({ error: 'Invalid admin secret' });
  }

  // Validate address if provided
  if (address && !validateAddress(address)) {
    return res.status(400).json({ error: 'Invalid address format' });
  }

  // Initialize Redis
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ error: 'Redis not configured' });
  }

  let redis;
  try {
    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  } catch (initError) {
    return res.status(500).json({ error: 'Redis init failed', message: initError.message });
  }

  try {
    const deleted = [];

    if (address) {
      // Reset single address
      const addr = address.toLowerCase();

      // Delete all keys for this address
      const keysToDelete = [
        CLICKS_KEY(addr),
        MILESTONES_KEY(addr),
        ACHIEVEMENTS_KEY(addr),
        STREAK_KEY(addr),
        TIME_CLICKS_KEY(addr),
        HUMAN_SESSION_KEY(addr),
      ];

      for (const key of keysToDelete) {
        const result = await redis.del(key);
        if (result) deleted.push(key);
      }

      // Remove from leaderboards (need to scan for entries containing this address)
      // For sorted sets, we need to find and remove the member
      const leaderboardEntry = await findLeaderboardEntry(redis, LEADERBOARD_KEY, addr);
      if (leaderboardEntry) {
        await redis.zrem(LEADERBOARD_KEY, leaderboardEntry);
        deleted.push(`${LEADERBOARD_KEY}:${addr}`);
      }

      const onchainEntry = await findLeaderboardEntry(redis, ONCHAIN_LEADERBOARD_KEY, addr);
      if (onchainEntry) {
        await redis.zrem(ONCHAIN_LEADERBOARD_KEY, onchainEntry);
        deleted.push(`${ONCHAIN_LEADERBOARD_KEY}:${addr}`);
      }

      // Remove from eligible set
      await redis.srem(ELIGIBLE_KEY, addr);

      return res.status(200).json({
        success: true,
        action: 'reset_single',
        address: addr,
        keysDeleted: deleted.length,
        deleted
      });

    } else {
      // Reset ALL data
      const keysToDelete = [
        LEADERBOARD_KEY,
        ONCHAIN_LEADERBOARD_KEY,
        ELIGIBLE_KEY,
        GLOBAL_CLICKS_KEY,
        GLOBAL_MILESTONES_KEY,
      ];

      for (const key of keysToDelete) {
        const result = await redis.del(key);
        if (result) deleted.push(key);
      }

      // Scan and delete all player-specific keys (V1 and V2)
      let cursor = '0';
      const patterns = [
        // V1 keys
        'clickstr:clicks:*',
        'clickstr:milestones:*',
        'clickstr:achievements:*',
        'clickstr:streak:*',
        'clickstr:time-clicks:*',
        'clickstr:human-session:*',
        // V2 keys
        'clickstr:v2:*',
      ];

      for (const pattern of patterns) {
        cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 100 });
          cursor = nextCursor;

          for (const key of keys) {
            await redis.del(key);
            deleted.push(key);
          }
        } while (cursor !== '0');
      }

      return res.status(200).json({
        success: true,
        action: 'reset_all',
        keysDeleted: deleted.length,
        deleted
      });
    }

  } catch (error) {
    console.error('Admin reset error:', error);
    return res.status(500).json({ error: 'Reset failed', message: error.message });
  }
}

// Helper to find a leaderboard entry by address
async function findLeaderboardEntry(redis, leaderboardKey, address) {
  // Get all entries and find the one with matching address
  const entries = await redis.zrange(leaderboardKey, 0, -1);

  for (const entry of entries) {
    try {
      const data = typeof entry === 'string' ? JSON.parse(entry) : entry;
      if (data.address === address) {
        return entry;
      }
    } catch {
      // Skip malformed entries
    }
  }

  return null;
}
