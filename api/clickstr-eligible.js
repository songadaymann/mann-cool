import { Redis } from '@upstash/redis';

/**
 * Stupid Clicker - NFT Eligibility API for Chainlink Functions
 *
 * This endpoint is designed to be called by Chainlink Functions to determine
 * which addresses are eligible for NFT airdrops.
 *
 * Endpoints:
 *   GET /api/clickstr-eligible
 *     - Returns list of all eligible addresses
 *     - Query params:
 *       - milestone: Filter by specific milestone (e.g., "dedicated", "legend")
 *       - limit: Max addresses to return (default 100)
 *       - claimed: Include already-claimed addresses (default false)
 *
 *   POST /api/clickstr-eligible
 *     - Mark addresses as having claimed their NFT
 *     - Body: { addresses: ["0x...", "0x..."], milestone: "dedicated" }
 *     - Requires admin secret in header
 */

// Redis keys
const ELIGIBLE_KEY = 'clickstr:nft-eligible';
const CLAIMED_KEY = (milestone) => `clickstr:nft-claimed:${milestone}`;
const MILESTONES_KEY = (addr) => `clickstr:milestones:${addr.toLowerCase()}`;
const CLICKS_KEY = (addr) => `clickstr:clicks:${addr.toLowerCase()}`;

// Milestones that qualify for NFT drops
const NFT_MILESTONES = ['dedicated', 'serious', 'obsessed', 'no-life', 'legend', 'transcendent', 'god'];

function validateAddress(address) {
  return address && /^0x[a-fA-F0-9]{40}$/.test(address);
}

export default async function handler(req, res) {
  if (process.env.CLICKSTR_ELIGIBLE_ENABLED !== 'true') {
    return res.status(410).json({
      success: false,
      deprecated: true,
      message: 'clickstr-eligible is disabled. Set CLICKSTR_ELIGIBLE_ENABLED=true to enable.'
    });
  }

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verify Redis is configured
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
    // GET - Fetch eligible addresses
    if (req.method === 'GET') {
      const { milestone, limit = '100', claimed = 'false', address } = req.query;
      const limitNum = Math.min(parseInt(limit, 10) || 100, 500);

      // Single address check
      if (address) {
        if (!validateAddress(address)) {
          return res.status(400).json({ error: 'Invalid address' });
        }

        const addr = address.toLowerCase();
        const milestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
        const stats = await redis.hgetall(CLICKS_KEY(addr));

        // Check which NFT milestones they've hit
        const eligibleFor = NFT_MILESTONES.filter(m => milestones.includes(m));

        // Check which they've already claimed
        const claimedMilestones = [];
        for (const m of eligibleFor) {
          const hasClaimed = await redis.sismember(CLAIMED_KEY(m), addr);
          if (hasClaimed) claimedMilestones.push(m);
        }

        const unclaimedEligible = eligibleFor.filter(m => !claimedMilestones.includes(m));

        return res.status(200).json({
          success: true,
          address: addr,
          totalClicks: parseInt(stats?.totalClicks || '0', 10),
          milestonesUnlocked: milestones,
          eligibleForNFT: eligibleFor,
          claimedNFT: claimedMilestones,
          unclaimedNFT: unclaimedEligible,
          canClaim: unclaimedEligible.length > 0
        });
      }

      // List all eligible addresses
      let eligibleAddresses = await redis.smembers(ELIGIBLE_KEY) || [];

      // Filter by milestone if specified
      if (milestone && NFT_MILESTONES.includes(milestone)) {
        const filtered = [];
        for (const addr of eligibleAddresses) {
          const milestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
          if (milestones.includes(milestone)) {
            // Check if already claimed (unless we want claimed too)
            const hasClaimed = await redis.sismember(CLAIMED_KEY(milestone), addr);
            if (claimed === 'true' || !hasClaimed) {
              filtered.push(addr);
            }
          }
        }
        eligibleAddresses = filtered;
      } else if (claimed !== 'true') {
        // Filter out addresses that have claimed ALL their eligible milestones
        const filtered = [];
        for (const addr of eligibleAddresses) {
          const milestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
          const eligibleMilestones = NFT_MILESTONES.filter(m => milestones.includes(m));

          let hasUnclaimed = false;
          for (const m of eligibleMilestones) {
            const hasClaimed = await redis.sismember(CLAIMED_KEY(m), addr);
            if (!hasClaimed) {
              hasUnclaimed = true;
              break;
            }
          }

          if (hasUnclaimed) filtered.push(addr);
        }
        eligibleAddresses = filtered;
      }

      // Apply limit
      const limitedAddresses = eligibleAddresses.slice(0, limitNum);

      // Get stats for each address
      const addressesWithStats = await Promise.all(
        limitedAddresses.map(async (addr) => {
          const stats = await redis.hgetall(CLICKS_KEY(addr));
          const milestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
          return {
            address: addr,
            totalClicks: parseInt(stats?.totalClicks || '0', 10),
            name: stats?.name || 'Anonymous',
            eligibleMilestones: NFT_MILESTONES.filter(m => milestones.includes(m))
          };
        })
      );

      // Sort by clicks descending
      addressesWithStats.sort((a, b) => b.totalClicks - a.totalClicks);

      return res.status(200).json({
        success: true,
        count: addressesWithStats.length,
        totalEligible: eligibleAddresses.length,
        addresses: addressesWithStats,
        availableMilestones: NFT_MILESTONES
      });
    }

    // POST - Mark addresses as claimed (admin only)
    if (req.method === 'POST') {
      // Verify admin secret
      const adminSecret = req.headers['x-admin-secret'];
      if (!adminSecret || adminSecret !== process.env.CLICKSTR_ADMIN_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const body = req.body || {};
      const { addresses, milestone } = body;

      if (!Array.isArray(addresses) || addresses.length === 0) {
        return res.status(400).json({ error: 'Missing addresses array' });
      }

      if (!milestone || !NFT_MILESTONES.includes(milestone)) {
        return res.status(400).json({
          error: 'Invalid milestone',
          validMilestones: NFT_MILESTONES
        });
      }

      // Validate all addresses
      const validAddresses = addresses
        .filter(validateAddress)
        .map(a => a.toLowerCase());

      if (validAddresses.length === 0) {
        return res.status(400).json({ error: 'No valid addresses provided' });
      }

      // Mark as claimed
      const claimedKey = CLAIMED_KEY(milestone);
      for (const addr of validAddresses) {
        await redis.sadd(claimedKey, addr);
      }

      return res.status(200).json({
        success: true,
        milestone,
        markedAsClaimed: validAddresses.length,
        addresses: validAddresses
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Stupid Clicker Eligible API error:', error);
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}
