import { Redis } from '@upstash/redis';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toHex } from 'viem';

/**
 * Stupid Clicker - NFT Claim Signature API
 *
 * Signs messages that authorize users to claim achievement NFTs.
 * The NFT contract verifies these signatures before minting.
 *
 * Flow:
 *   1. Frontend calls this endpoint with address + milestone
 *   2. Server verifies user is eligible (has unlocked milestone, hasn't claimed)
 *   3. Server signs: keccak256(address, tier, contractAddress)
 *   4. User submits signature to NFT contract, which verifies and mints
 *
 * Endpoints:
 *   POST /api/clickstr-claim-signature
 *     Body: { address: "0x...", milestone: "dedicated" } or { address: "0x...", tier: 4 }
 *     Returns: { signature: "0x...", tier: 4, milestone: {...} }
 *
 *   POST /api/clickstr-claim-signature (with action: "confirm")
 *     Body: { address: "0x...", tier: 4, txHash: "0x...", action: "confirm" }
 *     Confirms a successful on-chain claim (called after tx confirms)
 *
 * Security Features:
 *   - Rate limiting: 10 requests per minute per address
 *   - Atomic locks for global 1/1 milestone claims (prevents race conditions)
 */

// =============================================================================
// RATE LIMITING
// =============================================================================
const RATE_LIMIT_WINDOW = 60; // 1 minute in seconds
const RATE_LIMIT_MAX_REQUESTS = 10; // Max requests per window
const RATE_LIMIT_KEY = (addr) => `clickstr:rate-limit:claim:${addr.toLowerCase()}`;

// Global milestone lock key (for atomic claim of 1/1s)
const GLOBAL_LOCK_KEY = (tier) => `clickstr:global-lock:${tier}`;
const GLOBAL_LOCK_TTL = 30; // 30 seconds lock duration

// =============================================================================
// MILESTONE TIER MAPPING
// =============================================================================

// Maps milestone IDs to NFT tier numbers (must match contract expectations)
const MILESTONE_TO_TIER = {
  // Personal milestones (1-12)
  'first-timer': 1,
  'getting-started': 2,
  'warming-up': 3,
  'dedicated': 4,
  'serious-clicker': 5,
  'obsessed': 6,
  'no-sleep': 7,
  'touch-grass': 8,
  'legend': 9,
  'ascended': 10,
  'transcendent': 11,
  'click-god': 12,

  // Streak achievements (101-105)
  'week-warrior': 101,
  'month-master': 102,
  'perfect-attendance': 103,
  'day-one-og': 104,
  'final-day': 105,

  // Global 1/1 milestones (200-209) - powers of 10
  'global-1': 201,
  'global-100': 202,
  'global-1000': 203,
  'global-10000': 204,
  'global-100000': 205,
  'global-1000000': 206,
  'global-10000000': 207,
  'global-50000000': 208,
  'global-100000000': 209,

  // Hidden achievements (500+)
  'nice': 500,
  'blaze-it': 501,
  'devils-click': 502,
  'lucky-7s': 503,
  'elite': 504,
  'palindrome': 505,
};

// Reverse mapping for tier -> milestone info
const TIER_INFO = {
  1: { id: 'first-timer', name: 'First Timer', clicks: 1 },
  2: { id: 'getting-started', name: 'Getting Started', clicks: 100 },
  3: { id: 'warming-up', name: 'Warming Up', clicks: 500 },
  4: { id: 'dedicated', name: 'Dedicated', clicks: 1000 },
  5: { id: 'serious-clicker', name: 'Serious Clicker', clicks: 5000 },
  6: { id: 'obsessed', name: 'Obsessed', clicks: 10000 },
  7: { id: 'no-sleep', name: 'No Sleep', clicks: 25000 },
  8: { id: 'touch-grass', name: 'Touch Grass', clicks: 50000 },
  9: { id: 'legend', name: 'Legend', clicks: 100000 },
  10: { id: 'ascended', name: 'Ascended', clicks: 250000 },
  11: { id: 'transcendent', name: 'Transcendent', clicks: 500000 },
  12: { id: 'click-god', name: 'Click God', clicks: 1000000 },
  101: { id: 'week-warrior', name: 'Week Warrior', type: 'streak' },
  102: { id: 'month-master', name: 'Month Master', type: 'streak' },
  103: { id: 'perfect-attendance', name: 'Perfect Attendance', type: 'streak' },
  104: { id: 'day-one-og', name: 'Day One OG', type: 'epoch' },
  105: { id: 'final-day', name: 'The Final Day', type: 'epoch' },
  201: { id: 'global-1', name: 'The First Click', type: 'global', global: true },
  202: { id: 'global-100', name: 'Century', type: 'global', global: true },
  203: { id: 'global-1000', name: 'Thousandaire', type: 'global', global: true },
  204: { id: 'global-10000', name: 'Ten Grand', type: 'global', global: true },
  205: { id: 'global-100000', name: 'The Hundred Thousandth', type: 'global', global: true },
  206: { id: 'global-1000000', name: 'The Millionth Click', type: 'global', global: true },
  207: { id: 'global-10000000', name: 'Ten Million', type: 'global', global: true },
  208: { id: 'global-50000000', name: 'Halfway There', type: 'global', global: true },
  209: { id: 'global-100000000', name: 'The Final Click', type: 'global', global: true },
  500: { id: 'nice', name: 'Nice', type: 'hidden' },
  501: { id: 'blaze-it', name: 'Blaze It', type: 'hidden' },
  502: { id: 'devils-click', name: "Devil's Click", type: 'hidden' },
  503: { id: 'lucky-7s', name: 'Lucky 7s', type: 'hidden' },
  504: { id: 'elite', name: 'Elite', type: 'hidden' },
  505: { id: 'palindrome', name: 'Palindrome', type: 'hidden' },
};

// =============================================================================
// REDIS KEYS
// =============================================================================
const MILESTONES_KEY = (addr) => `clickstr:milestones:${addr.toLowerCase()}`;
const ACHIEVEMENTS_KEY = (addr) => `clickstr:achievements:${addr.toLowerCase()}`;
const NFT_CLAIMED_KEY = (addr) => `clickstr:nft-claimed:${addr.toLowerCase()}`; // Set of claimed tier numbers
const GLOBAL_MILESTONES_KEY = 'clickstr:global-milestones'; // Hash: milestoneId -> winner address

// =============================================================================
// HELPERS
// =============================================================================

function validateAddress(address) {
  return address && /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Check and update rate limit for an address
 * @returns {object} { allowed: boolean, remaining: number, resetIn: number }
 */
async function checkRateLimit(redis, address) {
  const key = RATE_LIMIT_KEY(address);
  const now = Math.floor(Date.now() / 1000);

  // Get current count and TTL
  const [count, ttl] = await Promise.all([
    redis.get(key),
    redis.ttl(key)
  ]);

  const currentCount = parseInt(count || '0', 10);

  if (currentCount >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetIn: ttl > 0 ? ttl : RATE_LIMIT_WINDOW
    };
  }

  // Increment counter
  if (currentCount === 0) {
    // New window - set with expiry
    await redis.setex(key, RATE_LIMIT_WINDOW, 1);
  } else {
    // Existing window - increment
    await redis.incr(key);
  }

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - currentCount - 1,
    resetIn: ttl > 0 ? ttl : RATE_LIMIT_WINDOW
  };
}

/**
 * Acquire a lock for global milestone claim (prevents race conditions)
 * Uses Redis SETNX for atomic operation
 * @returns {boolean} true if lock acquired, false if already locked
 */
async function acquireGlobalLock(redis, tier, address) {
  const key = GLOBAL_LOCK_KEY(tier);
  // SETNX returns 1 if key was set (lock acquired), 0 if key already exists
  const result = await redis.setnx(key, address.toLowerCase());
  if (result === 1) {
    // Set TTL to prevent deadlocks
    await redis.expire(key, GLOBAL_LOCK_TTL);
    return true;
  }
  return false;
}

/**
 * Release a global milestone lock
 */
async function releaseGlobalLock(redis, tier, address) {
  const key = GLOBAL_LOCK_KEY(tier);
  // Only release if we hold the lock
  const holder = await redis.get(key);
  if (holder && holder.toLowerCase() === address.toLowerCase()) {
    await redis.del(key);
  }
}

/**
 * Sign a claim message using EIP-191 personal sign
 * The NFT contract expects: keccak256(abi.encodePacked(address, tier, contractAddress))
 * Then wrapped with "\x19Ethereum Signed Message:\n32" prefix
 */
async function signClaimMessage(signerPrivateKey, userAddress, tier, contractAddress) {
  const account = privateKeyToAccount(signerPrivateKey);

  // Create the message hash: keccak256(abi.encodePacked(address, uint256, address))
  const messageHash = keccak256(
    encodePacked(
      ['address', 'uint256', 'address'],
      [userAddress, BigInt(tier), contractAddress]
    )
  );

  // Sign with EIP-191 personal sign (adds "\x19Ethereum Signed Message:\n32" prefix)
  const signature = await account.signMessage({
    message: { raw: messageHash }
  });

  return signature;
}

// =============================================================================
// HANDLER
// =============================================================================

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check required environment variables
  if (!process.env.NFT_SIGNER_PRIVATE_KEY) {
    console.error('NFT_SIGNER_PRIVATE_KEY not configured');
    return res.status(500).json({ error: 'Signing not configured' });
  }

  if (!process.env.NFT_CONTRACT_ADDRESS) {
    console.error('NFT_CONTRACT_ADDRESS not configured');
    return res.status(500).json({ error: 'Contract address not configured' });
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
    const body = req.body || {};
    const { address, milestone, tier: requestedTier, action, txHash } = body;

    // Validate address
    if (!validateAddress(address)) {
      return res.status(400).json({ error: 'Invalid or missing address' });
    }

    const addr = address.toLowerCase();

    // -------------------------------------------------------------------------
    // RATE LIMITING - Check before any expensive operations
    // -------------------------------------------------------------------------
    const rateLimit = await checkRateLimit(redis, addr);
    if (!rateLimit.allowed) {
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', rateLimit.resetIn.toString());
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded. Try again in ${rateLimit.resetIn} seconds.`,
        retryAfter: rateLimit.resetIn
      });
    }
    res.setHeader('X-RateLimit-Remaining', rateLimit.remaining.toString());
    res.setHeader('X-RateLimit-Reset', rateLimit.resetIn.toString());

    // -------------------------------------------------------------------------
    // CONFIRM ACTION - Mark a claim as confirmed after on-chain tx
    // -------------------------------------------------------------------------
    if (action === 'confirm') {
      const tierToConfirm = parseInt(requestedTier, 10);
      if (!tierToConfirm || !TIER_INFO[tierToConfirm]) {
        return res.status(400).json({ error: 'Invalid tier for confirmation' });
      }

      // Mark as confirmed in Redis
      await redis.sadd(NFT_CLAIMED_KEY(addr), String(tierToConfirm));

      // For global milestones, also mark in global registry
      const isGlobalConfirm = tierToConfirm >= 200 && tierToConfirm < 500;
      if (isGlobalConfirm) {
        const milestoneIdConfirm = TIER_INFO[tierToConfirm].id;
        await redis.hset(GLOBAL_MILESTONES_KEY, { [milestoneIdConfirm]: addr });
        // Release the lock if we held it
        await releaseGlobalLock(redis, tierToConfirm, addr);
      }

      return res.status(200).json({
        success: true,
        confirmed: true,
        tier: tierToConfirm,
        address: addr,
        txHash: txHash || null
      });
    }

    // -------------------------------------------------------------------------
    // SIGNATURE REQUEST - Generate signature for NFT claim
    // -------------------------------------------------------------------------

    // Determine tier from milestone ID or direct tier number
    let tier;
    let milestoneId;

    if (milestone) {
      tier = MILESTONE_TO_TIER[milestone];
      milestoneId = milestone;
      if (!tier) {
        return res.status(400).json({
          error: 'Invalid milestone',
          validMilestones: Object.keys(MILESTONE_TO_TIER)
        });
      }
    } else if (requestedTier) {
      tier = parseInt(requestedTier, 10);
      if (!TIER_INFO[tier]) {
        return res.status(400).json({ error: 'Invalid tier number' });
      }
      milestoneId = TIER_INFO[tier].id;
    } else {
      return res.status(400).json({ error: 'Missing milestone or tier' });
    }

    // Check if user has unlocked this milestone/achievement
    const isGlobal = tier >= 200 && tier < 500;
    const isStreak = tier >= 101 && tier < 200;
    const isHidden = tier >= 500;
    const isPersonal = tier >= 1 && tier <= 12;

    let hasUnlocked = false;

    if (isGlobal || isStreak || isHidden) {
      // Check achievements key
      const achievements = await redis.smembers(ACHIEVEMENTS_KEY(addr)) || [];
      hasUnlocked = achievements.includes(milestoneId);
    } else if (isPersonal) {
      // Check milestones key
      const milestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
      hasUnlocked = milestones.includes(milestoneId);
    }

    if (!hasUnlocked) {
      return res.status(403).json({
        error: 'Not eligible',
        message: `You haven't unlocked the "${TIER_INFO[tier]?.name || milestoneId}" milestone yet`,
        tier,
        milestone: milestoneId
      });
    }

    // Check if already claimed (off-chain tracking)
    const claimedTiers = await redis.smembers(NFT_CLAIMED_KEY(addr)) || [];
    if (claimedTiers.includes(String(tier))) {
      return res.status(400).json({
        error: 'Already claimed',
        message: `You've already claimed the NFT for "${TIER_INFO[tier]?.name || milestoneId}"`,
        tier,
        milestone: milestoneId
      });
    }

    // For global milestones, verify this user is the winner AND acquire lock
    if (isGlobal) {
      const winner = await redis.hget(GLOBAL_MILESTONES_KEY, milestoneId);
      if (winner && winner.toLowerCase() !== addr) {
        return res.status(403).json({
          error: 'Not the winner',
          message: 'This global milestone was claimed by someone else',
          tier,
          winner
        });
      }

      // Acquire atomic lock for global milestone (prevents race conditions)
      const lockAcquired = await acquireGlobalLock(redis, tier, addr);
      if (!lockAcquired) {
        return res.status(409).json({
          error: 'Claim in progress',
          message: 'Another claim for this global milestone is being processed. Please try again in a few seconds.',
          tier,
          milestone: milestoneId
        });
      }
    }

    // Sign the claim message
    const contractAddress = process.env.NFT_CONTRACT_ADDRESS;
    const signature = await signClaimMessage(
      process.env.NFT_SIGNER_PRIVATE_KEY,
      addr,
      tier,
      contractAddress
    );

    // Mark as claimed in Redis (optimistic - contract is source of truth)
    await redis.sadd(NFT_CLAIMED_KEY(addr), String(tier));

    // Return signature and tier info
    return res.status(200).json({
      success: true,
      signature,
      tier,
      milestone: TIER_INFO[tier] || { id: milestoneId, name: milestoneId },
      contractAddress,
      // Include data needed to call the contract
      claimData: {
        functionName: 'claim',
        args: [tier, signature]
      }
    });

  } catch (error) {
    console.error('Claim signature error:', error);
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}
