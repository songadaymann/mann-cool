import { Redis } from '@upstash/redis';
import { keccak256, encodePacked } from 'viem';

/**
 * Stupid Clicker - Frontend Click Tracking API
 *
 * Tracks FRONTEND clicks only (not on-chain submissions).
 * This enables Cookie Clicker-style rewards for human players using the UI.
 *
 * Redis keys:
 *   - stupid-clicker:clicks:{address} - Hash with cumulative stats per address
 *   - stupid-clicker:leaderboard - Sorted set for rankings by total frontend clicks
 *   - stupid-clicker:milestones:{address} - Set of unlocked milestone IDs
 *
 * Endpoints:
 *   GET  /api/stupid-clicker?address=0x...     - Get player stats
 *   POST /api/stupid-clicker                    - Record clicks from frontend
 *   GET  /api/stupid-clicker?leaderboard=true  - Get leaderboard
 *   GET  /api/stupid-clicker?eligible=true&address=0x... - Check NFT eligibility
 */

// =============================================================================
// MILESTONE & ACHIEVEMENT DEFINITIONS
// =============================================================================

// Personal Milestones - unlock at these individual click counts
// tier = NFT token ID in StupidClickerNFT contract (1-12 for personal milestones)
const PERSONAL_MILESTONES = [
  { id: 'first-timer', tier: 1, clicks: 1, name: 'First Timer', description: 'Your first click!', cosmetic: null, nftEligible: true },
  { id: 'getting-started', tier: 2, clicks: 100, name: 'Getting Started', description: '100 clicks', cosmetic: 'cursor-bronze', nftEligible: true },
  { id: 'warming-up', tier: 3, clicks: 500, name: 'Warming Up', description: '500 clicks', cosmetic: 'cursor-silver', nftEligible: true },
  { id: 'dedicated', tier: 4, clicks: 1000, name: 'Dedicated', description: '1,000 clicks', cosmetic: 'cursor-gold', nftEligible: true },
  { id: 'serious-clicker', tier: 5, clicks: 5000, name: 'Serious Clicker', description: '5,000 clicks', cosmetic: 'button-red-glow', nftEligible: true },
  { id: 'obsessed', tier: 6, clicks: 10000, name: 'Obsessed', description: '10,000 clicks', cosmetic: 'button-blue', nftEligible: true },
  { id: 'no-sleep', tier: 7, clicks: 25000, name: 'No Sleep', description: '25,000 clicks', cosmetic: 'cursor-rainbow', nftEligible: true },
  { id: 'touch-grass', tier: 8, clicks: 50000, name: 'Touch Grass', description: '50,000 clicks', cosmetic: 'button-purple', nftEligible: true },
  { id: 'legend', tier: 9, clicks: 100000, name: 'Legend', description: '100,000 clicks', cosmetic: 'button-animated', nftEligible: true },
  { id: 'ascended', tier: 10, clicks: 250000, name: 'Ascended', description: '250,000 clicks', cosmetic: 'cursor-fire', nftEligible: true },
  { id: 'transcendent', tier: 11, clicks: 500000, name: 'Transcendent', description: '500,000 clicks', cosmetic: 'button-gold', nftEligible: true },
  { id: 'click-god', tier: 12, clicks: 1000000, name: 'Click God', description: '1,000,000 clicks', cosmetic: 'everything-special', nftEligible: true },
];

// Global Milestones - first person to hit X OVERALL clicks wins (1/1 NFTs)
// tier = NFT token ID (200-209 for global 1/1 milestones)
const GLOBAL_MILESTONES = [
  { id: 'global-1', tier: 201, globalClick: 1, name: 'The First Click', description: 'The very first click ever' },
  { id: 'global-100', tier: 202, globalClick: 100, name: 'Century', description: 'The 100th click' },
  { id: 'global-1000', tier: 203, globalClick: 1000, name: 'Thousandaire', description: 'The 1,000th click' },
  { id: 'global-10000', tier: 204, globalClick: 10000, name: 'Ten Grand', description: 'The 10,000th click' },
  { id: 'global-100000', tier: 205, globalClick: 100000, name: 'The Hundred Thousandth', description: 'The 100,000th click' },
  { id: 'global-1000000', tier: 206, globalClick: 1000000, name: 'The Millionth Click', description: 'The 1,000,000th click' },
  { id: 'global-10000000', tier: 207, globalClick: 10000000, name: 'Ten Million', description: 'The 10,000,000th click' },
  { id: 'global-50000000', tier: 208, globalClick: 50000000, name: 'Halfway There', description: 'The 50,000,000th click' },
  { id: 'global-100000000', tier: 209, globalClick: 100000000, name: 'The Final Click', description: 'The 100,000,000th click' },
];

// Hidden Achievements - triggered at specific personal click numbers (don't announce!)
// tier = NFT token ID (500+ for hidden achievements)
const HIDDEN_ACHIEVEMENTS = [
  { id: 'nice', tier: 500, triggerClick: 69, name: 'Nice', description: 'Nice.' },
  { id: 'blaze-it', tier: 501, triggerClick: 420, name: 'Blaze It', description: '420 blaze it' },
  { id: 'devils-click', tier: 502, triggerClick: 666, name: "Devil's Click", description: 'The number of the beast' },
  { id: 'lucky-7s', tier: 503, triggerClick: 777, name: 'Lucky 7s', description: 'Jackpot!' },
  { id: 'elite', tier: 504, triggerClick: 1337, name: 'Elite', description: 'L33T H4X0R' },
  { id: 'palindrome', tier: 505, triggerClick: 12321, name: 'Palindrome', description: 'Reads the same forwards and backwards' },
];

// Streak Achievements
// tier = NFT token ID (101-103 for streak achievements)
const STREAK_ACHIEVEMENTS = [
  { id: 'week-warrior', tier: 101, days: 7, name: 'Week Warrior', description: 'Clicked 7 days in a row' },
  { id: 'month-master', tier: 102, days: 30, name: 'Month Master', description: 'Clicked 30 days in a row' },
  { id: 'perfect-attendance', tier: 103, days: 90, name: 'Perfect Attendance', description: 'Clicked all 90 days' },
];

// Time-Based Achievements
const TIME_ACHIEVEMENTS = [
  { id: 'night-owl', name: 'Night Owl', description: '1,000 clicks between midnight-6am', requirement: { clicks: 1000, startHour: 0, endHour: 6 } },
  { id: 'early-bird', name: 'Early Bird', description: '1,000 clicks between 5am-9am', requirement: { clicks: 1000, startHour: 5, endHour: 9 } },
  { id: 'weekend-warrior', name: 'Weekend Warrior', description: '5,000 clicks on weekends', requirement: { clicks: 5000, weekendOnly: true } },
];

// Epoch-Based Achievements
// tier = NFT token ID (104-105 for epoch achievements)
const EPOCH_ACHIEVEMENTS = [
  { id: 'day-one-og', tier: 104, epoch: 1, name: 'Day One OG', description: 'Clicked during epoch 1' },
  { id: 'final-day', tier: 105, epoch: 90, name: 'The Final Day', description: 'Clicked during epoch 90' },
];

// Legacy alias for backwards compatibility
const MILESTONES = PERSONAL_MILESTONES;

// =============================================================================
// REDIS KEYS
// =============================================================================
const CLICKS_KEY = (addr) => `stupid-clicker:clicks:${addr.toLowerCase()}`;
const LEADERBOARD_KEY = 'stupid-clicker:leaderboard';
const ONCHAIN_LEADERBOARD_KEY = 'stupid-clicker:onchain-leaderboard'; // Tracks on-chain submissions via frontend
const MILESTONES_KEY = (addr) => `stupid-clicker:milestones:${addr.toLowerCase()}`;
const ACHIEVEMENTS_KEY = (addr) => `stupid-clicker:achievements:${addr.toLowerCase()}`;
const ELIGIBLE_KEY = 'stupid-clicker:nft-eligible';
const GLOBAL_CLICKS_KEY = 'stupid-clicker:global-clicks';
const GLOBAL_MILESTONES_KEY = 'stupid-clicker:global-milestones'; // Hash: milestoneId -> winner address
const STREAK_KEY = (addr) => `stupid-clicker:streak:${addr.toLowerCase()}`;
const TIME_CLICKS_KEY = (addr) => `stupid-clicker:time-clicks:${addr.toLowerCase()}`; // Hash for time-based tracking
const HUMAN_SESSION_KEY = (addr) => `stupid-clicker:human-session:${addr.toLowerCase()}`; // Turnstile verification session

// =============================================================================
// CONSTANTS
// =============================================================================
const HUMAN_SESSION_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
const CLICKS_BEFORE_VERIFICATION = 500; // Require verification after this many clicks per session

// Proof-of-work constants for off-chain nonce validation
// These should match the contract's difficulty settings
const POW_CHAIN_ID = 11155111; // Sepolia - update for mainnet
const POW_DIFFICULTY_TARGET = BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'); // Max difficulty (easiest)

function validateAddress(address) {
  return address && /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Verify a proof-of-work nonce
 * This replicates the on-chain verification logic for off-chain click validation
 *
 * @param {string} address - User's Ethereum address
 * @param {string} nonceStr - Nonce as a string (BigInt serialized)
 * @param {number} epoch - Current epoch (optional, defaults to 0 for off-chain)
 * @returns {boolean} - True if nonce is valid
 */
function verifyNonce(address, nonceStr, epoch = 0) {
  try {
    const nonce = BigInt(nonceStr);

    // Pack the data the same way the contract does:
    // abi.encodePacked(msg.sender, nonce, currentEpoch, block.chainid)
    const packed = encodePacked(
      ['address', 'uint256', 'uint256', 'uint256'],
      [address, nonce, BigInt(epoch), BigInt(POW_CHAIN_ID)]
    );

    const hash = keccak256(packed);
    const hashBigInt = BigInt(hash);

    // Valid if hash is below difficulty target
    return hashBigInt < POW_DIFFICULTY_TARGET;
  } catch (error) {
    console.error('Nonce verification error:', error);
    return false;
  }
}

/**
 * Verify an array of nonces and return how many are valid
 *
 * @param {string} address - User's Ethereum address
 * @param {string[]} nonces - Array of nonce strings
 * @param {number} epoch - Current epoch
 * @returns {{ validCount: number, invalidCount: number }}
 */
function verifyNonces(address, nonces, epoch = 0) {
  let validCount = 0;
  let invalidCount = 0;

  for (const nonceStr of nonces) {
    if (verifyNonce(address, nonceStr, epoch)) {
      validCount++;
    } else {
      invalidCount++;
    }
  }

  return { validCount, invalidCount };
}

// Verify Cloudflare Turnstile token
async function verifyTurnstile(token) {
  if (!process.env.TURNSTILE_SECRET_KEY) {
    // Turnstile not configured, skip verification
    return { success: true, skipped: true };
  }

  if (!token) {
    return { success: false, error: 'Missing verification token' };
  }

  try {
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: process.env.TURNSTILE_SECRET_KEY,
          response: token,
        }),
      }
    );

    const data = await response.json();
    console.log('Turnstile verification response:', JSON.stringify(data));
    return { success: data.success, error: data.success ? null : (data['error-codes']?.join(', ') || 'Verification failed') };
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return { success: false, error: 'Verification service error' };
  }
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
    // GET - Fetch stats, leaderboard, or eligibility
    if (req.method === 'GET') {
      const { address, leaderboard, eligible, limit = '50' } = req.query;

      // Leaderboard request
      if (leaderboard === 'true') {
        const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

        // Get top clickers (highest clicks = best, so use ZREVRANGE)
        const entries = await redis.zrange(LEADERBOARD_KEY, 0, limitNum - 1, {
          rev: true,
          withScores: true
        });

        // Parse entries: [member, score, member, score, ...]
        const parsed = [];
        for (let i = 0; i < entries.length; i += 2) {
          try {
            const data = typeof entries[i] === 'string' ? JSON.parse(entries[i]) : entries[i];
            parsed.push({
              rank: Math.floor(i / 2) + 1,
              ...data,
              totalClicks: parseInt(entries[i + 1], 10)
            });
          } catch {
            // Skip malformed entries
          }
        }

        return res.status(200).json({
          success: true,
          leaderboard: parsed,
          total: await redis.zcard(LEADERBOARD_KEY)
        });
      }

      // Eligibility check
      if (eligible === 'true') {
        if (!validateAddress(address)) {
          return res.status(400).json({ error: 'Invalid or missing address' });
        }

        const isEligible = await redis.sismember(ELIGIBLE_KEY, address.toLowerCase());
        const stats = await redis.hgetall(CLICKS_KEY(address));
        const unlockedMilestones = await redis.smembers(MILESTONES_KEY(address));

        return res.status(200).json({
          success: true,
          address: address.toLowerCase(),
          eligible: Boolean(isEligible),
          totalClicks: parseInt(stats?.totalClicks || '0', 10),
          unlockedMilestones: unlockedMilestones || [],
          nextMilestone: MILESTONES.find(m => !unlockedMilestones?.includes(m.id)) || null
        });
      }

      // Human verification status check
      if (req.query.verification === 'true') {
        if (!validateAddress(address)) {
          return res.status(400).json({ error: 'Invalid or missing address' });
        }

        const addr = address.toLowerCase();
        const now = Date.now();
        const humanSession = await redis.hgetall(HUMAN_SESSION_KEY(addr));
        const sessionExpiry = parseInt(humanSession?.expiresAt || '0', 10);
        const sessionClicks = parseInt(humanSession?.clicksSinceVerify || '0', 10);
        const isSessionValid = sessionExpiry > now;
        const clicksRemaining = isSessionValid ? Math.max(0, CLICKS_BEFORE_VERIFICATION - sessionClicks) : 0;
        const timeRemaining = isSessionValid ? sessionExpiry - now : 0;

        return res.status(200).json({
          success: true,
          address: addr,
          verified: isSessionValid,
          clicksUntilVerification: clicksRemaining,
          timeUntilExpiry: timeRemaining,
          expiresAt: isSessionValid ? sessionExpiry : null,
          turnstileRequired: !!process.env.TURNSTILE_SECRET_KEY,
          turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || process.env.TURNSTILE_SITE_KEY || null
        });
      }

      // Global stats request (no address)
      if (req.query.global === 'true') {
        const globalClicks = parseInt(await redis.get(GLOBAL_CLICKS_KEY) || '0', 10);
        const globalMilestoneWinners = await redis.hgetall(GLOBAL_MILESTONES_KEY) || {};
        const totalPlayers = await redis.zcard(LEADERBOARD_KEY);

        return res.status(200).json({
          success: true,
          globalClicks,
          totalPlayers,
          globalMilestones: GLOBAL_MILESTONES.map(gm => ({
            ...gm,
            winner: globalMilestoneWinners[gm.id] || null,
            claimed: !!globalMilestoneWinners[gm.id]
          }))
        });
      }

      // Player stats request
      if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid or missing address' });
      }

      const addr = address.toLowerCase();
      const stats = await redis.hgetall(CLICKS_KEY(addr));
      const unlockedMilestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
      const unlockedAchievements = await redis.smembers(ACHIEVEMENTS_KEY(addr)) || [];
      const streakData = await redis.hgetall(STREAK_KEY(addr)) || {};
      const globalClicks = parseInt(await redis.get(GLOBAL_CLICKS_KEY) || '0', 10);

      const rank = await redis.zrevrank(LEADERBOARD_KEY, JSON.stringify({
        address: addr,
        name: stats?.name || 'Anonymous'
      }));

      const totalClicks = parseInt(stats?.totalClicks || '0', 10);
      const nextMilestone = PERSONAL_MILESTONES.find(m => m.clicks > totalClicks);

      // Calculate unlocked cosmetics
      const unlockedCosmetics = PERSONAL_MILESTONES
        .filter(m => unlockedMilestones.includes(m.id) && m.cosmetic)
        .map(m => m.cosmetic);

      return res.status(200).json({
        success: true,
        address: addr,
        name: stats?.name || 'Anonymous',
        totalClicks,
        globalClicks,
        sessionsCount: parseInt(stats?.sessionsCount || '0', 10),
        lastSessionAt: stats?.lastSessionAt ? parseInt(stats.lastSessionAt, 10) : null,
        rank: rank !== null ? rank + 1 : null,
        streak: {
          current: parseInt(streakData.currentStreak || '0', 10),
          longest: parseInt(streakData.longestStreak || '0', 10),
          totalDays: parseInt(streakData.totalDays || '0', 10)
        },
        milestones: {
          unlocked: unlockedMilestones,
          next: nextMilestone || null,
          all: PERSONAL_MILESTONES
        },
        achievements: {
          unlocked: unlockedAchievements,
          global: GLOBAL_MILESTONES.filter(gm => unlockedAchievements.includes(gm.id)),
          hidden: HIDDEN_ACHIEVEMENTS.filter(ha => unlockedAchievements.includes(ha.id)),
          streaks: STREAK_ACHIEVEMENTS.filter(sa => unlockedAchievements.includes(sa.id)),
          epoch: EPOCH_ACHIEVEMENTS.filter(ea => unlockedAchievements.includes(ea.id))
        },
        cosmetics: {
          unlocked: unlockedCosmetics,
          equipped: stats?.equippedCursor || null,
          equippedButton: stats?.equippedButton || null
        }
      });
    }

    // POST - Record frontend clicks or on-chain submissions
    if (req.method === 'POST') {
      const body = req.body || {};
      const { address, clicks, onChainClicks, txHash, name, epoch, timestamp, turnstileToken, nonces } = body;

      // Validate address (required for all POST requests)
      if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid or missing address' });
      }

      const addr = address.toLowerCase();

      // Check if nonces are provided for proof-of-work validation
      const hasNonces = Array.isArray(nonces) && nonces.length > 0;

      // -----------------------------------------------------------------------
      // ON-CHAIN SUBMISSION TRACKING (no Turnstile required - blockchain is proof)
      // -----------------------------------------------------------------------
      if (onChainClicks && typeof onChainClicks === 'number' && onChainClicks > 0) {
        // Get current on-chain stats
        const currentStats = await redis.hgetall(CLICKS_KEY(addr));
        const previousOnChain = parseInt(currentStats?.onChainClicks || '0', 10);
        const newOnChainTotal = previousOnChain + onChainClicks;
        const playerName = currentStats?.name || 'Anonymous';

        // Update on-chain click count in user stats
        await redis.hset(CLICKS_KEY(addr), {
          onChainClicks: newOnChainTotal,
          lastOnChainAt: Date.now(),
          lastTxHash: txHash || null
        });

        // Update on-chain leaderboard
        await redis.zadd(ONCHAIN_LEADERBOARD_KEY, {
          score: newOnChainTotal,
          member: JSON.stringify({ address: addr, name: playerName })
        });

        return res.status(200).json({
          success: true,
          address: addr,
          onChainClicksRecorded: onChainClicks,
          totalOnChainClicks: newOnChainTotal,
          txHash: txHash || null
        });
      }

      // -----------------------------------------------------------------------
      // FRONTEND CLICK TRACKING (requires Turnstile OR proof-of-work nonces)
      // -----------------------------------------------------------------------
      if (!clicks || typeof clicks !== 'number' || clicks < 1 || clicks > 10000) {
        return res.status(400).json({ error: 'Invalid clicks count (must be 1-10000)' });
      }

      const now = timestamp || Date.now();
      const sanitizedName = name ? String(name).slice(0, 20).replace(/[^a-zA-Z0-9 ._-]/g, '') : null;

      // -----------------------------------------------------------------------
      // PROOF-OF-WORK VERIFICATION (nonces)
      // If nonces are provided, verify them as proof-of-work. This bypasses
      // Turnstile and is used for off-chain submissions when game is inactive.
      // -----------------------------------------------------------------------
      let verifiedByNonces = false;
      let actualClicks = clicks;

      if (hasNonces) {
        // Verify each nonce matches the expected difficulty
        const { validCount, invalidCount } = verifyNonces(addr, nonces, epoch || 0);

        if (validCount === 0) {
          return res.status(400).json({
            error: 'No valid nonces provided',
            message: 'All proof-of-work nonces failed verification'
          });
        }

        if (invalidCount > 0) {
          console.warn(`[PoW] Address ${addr}: ${invalidCount}/${nonces.length} nonces failed verification`);
        }

        // Only count valid nonces as clicks
        actualClicks = validCount;
        verifiedByNonces = true;

        console.log(`[PoW] Address ${addr}: ${validCount} valid nonces verified (${invalidCount} invalid)`);
      }

      // -----------------------------------------------------------------------
      // HUMAN VERIFICATION (Turnstile) - skipped if nonces were verified
      // Check if user has a valid human session, or needs to verify
      // -----------------------------------------------------------------------
      if (!verifiedByNonces) {
        const humanSession = await redis.hgetall(HUMAN_SESSION_KEY(addr));
        const sessionExpiry = parseInt(humanSession?.expiresAt || '0', 10);
        const sessionClicks = parseInt(humanSession?.clicksSinceVerify || '0', 10);
        const isSessionValid = sessionExpiry > now;
        const needsReverification = sessionClicks + actualClicks >= CLICKS_BEFORE_VERIFICATION;

        // Determine if we need Turnstile verification
        let requireVerification = false;
        let verificationReason = null;

        if (!isSessionValid) {
          requireVerification = true;
          verificationReason = 'session_expired';
        } else if (needsReverification) {
          requireVerification = true;
          verificationReason = 'click_limit';
        }

        // If verification required, check for Turnstile token
        if (requireVerification && process.env.TURNSTILE_SECRET_KEY) {
          if (!turnstileToken) {
            return res.status(403).json({
              error: 'Human verification required',
              reason: verificationReason,
              requiresVerification: true,
              message: verificationReason === 'session_expired'
                ? 'Please complete verification to continue clicking'
                : 'You\'ve been clicking for a while! Please verify you\'re human to continue'
            });
          }

          // Verify the token
          const verification = await verifyTurnstile(turnstileToken);
          if (!verification.success) {
            return res.status(403).json({
              error: 'Verification failed',
              reason: verification.error,
              requiresVerification: true
            });
          }

          // Verification successful - create/renew session
          await redis.hset(HUMAN_SESSION_KEY(addr), {
            verifiedAt: now,
            expiresAt: now + HUMAN_SESSION_DURATION,
            clicksSinceVerify: 0
          });
        } else if (isSessionValid) {
          // Update clicks since last verification
          await redis.hset(HUMAN_SESSION_KEY(addr), {
            clicksSinceVerify: sessionClicks + actualClicks
          });
        } else {
          // No Turnstile configured - create a session anyway (dev mode)
          await redis.hset(HUMAN_SESSION_KEY(addr), {
            verifiedAt: now,
            expiresAt: now + HUMAN_SESSION_DURATION,
            clicksSinceVerify: actualClicks,
            devMode: true
          });
        }
      }

      // Get current stats
      const currentStats = await redis.hgetall(CLICKS_KEY(addr));
      const previousClicks = parseInt(currentStats?.totalClicks || '0', 10);
      const newTotalClicks = previousClicks + actualClicks;
      const playerName = sanitizedName || currentStats?.name || 'Anonymous';

      // Get and update global click count
      const previousGlobalClicks = parseInt(await redis.get(GLOBAL_CLICKS_KEY) || '0', 10);
      const newGlobalClicks = previousGlobalClicks + actualClicks;
      await redis.set(GLOBAL_CLICKS_KEY, newGlobalClicks);

      // Track streak (days clicked in a row)
      const today = new Date(now).toISOString().split('T')[0]; // YYYY-MM-DD
      const streakData = await redis.hgetall(STREAK_KEY(addr)) || {};
      const lastClickDate = streakData.lastDate;
      let currentStreak = parseInt(streakData.currentStreak || '0', 10);
      let longestStreak = parseInt(streakData.longestStreak || '0', 10);

      if (lastClickDate !== today) {
        const yesterday = new Date(now - 86400000).toISOString().split('T')[0];
        if (lastClickDate === yesterday) {
          currentStreak += 1;
        } else if (!lastClickDate) {
          currentStreak = 1;
        } else {
          currentStreak = 1; // Streak broken
        }
        longestStreak = Math.max(longestStreak, currentStreak);
        await redis.hset(STREAK_KEY(addr), {
          lastDate: today,
          currentStreak,
          longestStreak,
          totalDays: parseInt(streakData.totalDays || '0', 10) + 1
        });
      }

      // Update player stats
      await redis.hset(CLICKS_KEY(addr), {
        totalClicks: newTotalClicks,
        sessionsCount: parseInt(currentStats?.sessionsCount || '0', 10) + 1,
        lastSessionAt: now,
        lastSessionClicks: actualClicks,
        name: playerName,
        ...(verifiedByNonces ? { lastPoWSubmit: now } : {})
      });

      // Update leaderboard
      await redis.zadd(LEADERBOARD_KEY, {
        score: newTotalClicks,
        member: JSON.stringify({ address: addr, name: playerName })
      });

      // Collect all new achievements/milestones
      const newMilestones = [];
      const newAchievements = [];

      // ---------------------------------------------------------------------
      // 1. Check PERSONAL MILESTONES
      // ---------------------------------------------------------------------
      const unlockedMilestones = await redis.smembers(MILESTONES_KEY(addr)) || [];

      for (const milestone of PERSONAL_MILESTONES) {
        if (newTotalClicks >= milestone.clicks && !unlockedMilestones.includes(milestone.id)) {
          await redis.sadd(MILESTONES_KEY(addr), milestone.id);
          newMilestones.push(milestone);

          // Mark as NFT eligible
          if (milestone.nftEligible) {
            await redis.sadd(ELIGIBLE_KEY, addr);
          }
        }
      }

      // ---------------------------------------------------------------------
      // 2. Check GLOBAL MILESTONES (1/1 - first person to cross threshold wins)
      // ---------------------------------------------------------------------
      for (const gm of GLOBAL_MILESTONES) {
        // Check if this click batch crossed the global threshold
        if (previousGlobalClicks < gm.globalClick && newGlobalClicks >= gm.globalClick) {
          // Check if anyone has claimed this milestone yet
          const existingWinner = await redis.hget(GLOBAL_MILESTONES_KEY, gm.id);
          if (!existingWinner) {
            // This player wins!
            await redis.hset(GLOBAL_MILESTONES_KEY, { [gm.id]: addr });
            await redis.sadd(ACHIEVEMENTS_KEY(addr), gm.id);
            await redis.sadd(ELIGIBLE_KEY, addr);
            newAchievements.push({ ...gm, type: 'global', legendary: true });
          }
        }
      }

      // ---------------------------------------------------------------------
      // 3. Check HIDDEN ACHIEVEMENTS (specific click numbers)
      // ---------------------------------------------------------------------
      const unlockedAchievements = await redis.smembers(ACHIEVEMENTS_KEY(addr)) || [];

      for (const hidden of HIDDEN_ACHIEVEMENTS) {
        // Did the player's click count pass through this number?
        if (previousClicks < hidden.triggerClick && newTotalClicks >= hidden.triggerClick) {
          if (!unlockedAchievements.includes(hidden.id)) {
            await redis.sadd(ACHIEVEMENTS_KEY(addr), hidden.id);
            await redis.sadd(ELIGIBLE_KEY, addr);
            newAchievements.push({ ...hidden, type: 'hidden', surprise: true });
          }
        }
      }

      // ---------------------------------------------------------------------
      // 4. Check STREAK ACHIEVEMENTS
      // ---------------------------------------------------------------------
      for (const streak of STREAK_ACHIEVEMENTS) {
        if (currentStreak >= streak.days && !unlockedAchievements.includes(streak.id)) {
          await redis.sadd(ACHIEVEMENTS_KEY(addr), streak.id);
          await redis.sadd(ELIGIBLE_KEY, addr);
          newAchievements.push({ ...streak, type: 'streak' });
        }
      }

      // ---------------------------------------------------------------------
      // 5. Check EPOCH ACHIEVEMENTS
      // ---------------------------------------------------------------------
      if (epoch) {
        for (const ea of EPOCH_ACHIEVEMENTS) {
          if (epoch === ea.epoch && !unlockedAchievements.includes(ea.id)) {
            await redis.sadd(ACHIEVEMENTS_KEY(addr), ea.id);
            await redis.sadd(ELIGIBLE_KEY, addr);
            newAchievements.push({ ...ea, type: 'epoch' });
          }
        }
      }

      // Get final rank
      const rank = await redis.zrevrank(LEADERBOARD_KEY, JSON.stringify({
        address: addr,
        name: playerName
      }));

      return res.status(200).json({
        success: true,
        address: addr,
        clicksRecorded: actualClicks,
        totalClicks: newTotalClicks,
        globalClicks: newGlobalClicks,
        rank: rank !== null ? rank + 1 : null,
        streak: { current: currentStreak, longest: longestStreak },
        newMilestones: newMilestones.length > 0 ? newMilestones : null,
        newAchievements: newAchievements.length > 0 ? newAchievements : null,
        nextMilestone: PERSONAL_MILESTONES.find(m => m.clicks > newTotalClicks) || null,
        verifiedByPoW: verifiedByNonces
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Stupid Clicker API error:', error);
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}
