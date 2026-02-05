import { Redis } from '@upstash/redis';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, toHex, createPublicClient, http } from 'viem';
import { mainnet, sepolia } from 'viem/chains';

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
// IMPORTANT: Must match clickstr.js definitions exactly!
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

  // Global 1/1 milestones - Main (200-213) - matches milestones-v2.csv
  'global-1': 200,
  'global-10': 201,
  'global-100': 202,
  'global-1000': 203,
  'global-10000': 204,
  'global-100000': 205,
  'global-1000000': 206,
  'global-10000000': 207,
  'global-100000000': 208,
  'global-1000000000': 209,
  'global-10000000000': 210,
  'global-100000000000': 211,
  'global-1000000000000': 212,
  'global-10000000000000': 213,

  // Global 1/1 milestones - Meme numbers (220-229) - matches milestones-v2.csv
  'global-69': 220,
  'global-420': 221,
  'global-666': 222,
  'global-777': 223,
  'global-1337': 224,
  'global-42069': 225,
  'global-69420': 226,
  'global-8008135': 227,
  'global-8675309': 228,
  'global-42': 229,

  // Hidden personal achievements - Meme (500-511)
  'nice': 500,
  'blaze-it': 501,
  'devils-click': 502,
  'lucky-7s': 503,
  'elite': 504,
  'calculator-word': 505,
  'perfect-number': 506,
  'ultra-nice': 507,
  'old-school': 508,
  'double-blaze': 509,
  'maximum-evil': 510,
  'nice-nice-nice': 511,

  // Hidden personal - Ones family (520-523)
  'triple-ones': 520,
  'quad-ones': 521,
  'make-a-wish': 522,
  'six-ones': 523,

  // Hidden personal - Sevens family (524-526)
  'jackpot': 524,
  'mega-jackpot': 525,
  'slot-machine-god': 526,

  // Hidden personal - Eights family (527-529)
  'prosperity': 527,
  'very-lucky': 528,
  'fortune': 529,

  // Hidden personal - Nines family (530-532)
  'so-close': 530,
  'edge-lord': 531,
  'one-away': 532,

  // Hidden personal - Palindromes (540-545)
  'binary-palindrome': 540,
  'bookends': 541,
  'symmetric': 542,
  'counting-palindrome': 543,
  'mirror-mirror': 544,
  'the-mountain': 545,

  // Hidden personal - Mathematical (560-566)
  'fine-structure': 560,
  'pi-day': 561,
  'golden': 562,
  'eulers-click': 563,
  'more-pi': 564,
  'pi-squared': 565,
  'full-pi': 566,

  // Hidden personal - Powers of 2 (580-588)
  'byte': 580,
  'half-k': 581,
  'kilobyte': 582,
  'the-game': 583,
  'pow-2-12': 584,
  'pow-2-13': 585,
  'pow-2-14': 586,
  'pow-2-15': 587,
  'pow-2-16': 588,

  // Hidden personal - Cultural (600-609)
  'not-found': 600,
  'server-error': 601,
  'jumbo': 602,
  'emergency': 603,
  'orwellian': 604,
  'space-odyssey': 605,
  'end-times': 606,
  'love-you-3000': 607,
  'meaning-of-everything': 608,
  'seasons-of-love': 609,
};

// Reverse mapping for tier -> milestone info
// IMPORTANT: Must match clickstr.js definitions exactly!
const TIER_INFO = {
  // Personal milestones (1-12)
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

  // Streak/Epoch (101-105)
  101: { id: 'week-warrior', name: 'Week Warrior', type: 'streak' },
  102: { id: 'month-master', name: 'Month Master', type: 'streak' },
  103: { id: 'perfect-attendance', name: 'Perfect Attendance', type: 'streak' },
  104: { id: 'day-one-og', name: 'Day One OG', type: 'epoch' },
  105: { id: 'final-day', name: 'The Final Day', type: 'epoch' },

  // Global 1/1 - Main (200-213) - matches milestones-v2.csv
  200: { id: 'global-1', name: 'The First Click', type: 'global', global: true },
  201: { id: 'global-10', name: 'The Tenth', type: 'global', global: true },
  202: { id: 'global-100', name: 'Century', type: 'global', global: true },
  203: { id: 'global-1000', name: 'Thousandaire', type: 'global', global: true },
  204: { id: 'global-10000', name: 'Ten Grand', type: 'global', global: true },
  205: { id: 'global-100000', name: 'The Hundred Thousandth', type: 'global', global: true },
  206: { id: 'global-1000000', name: 'The Millionth Click', type: 'global', global: true },
  207: { id: 'global-10000000', name: 'Ten Million', type: 'global', global: true },
  208: { id: 'global-100000000', name: 'Hundred Million', type: 'global', global: true },
  209: { id: 'global-1000000000', name: 'Billionaire', type: 'global', global: true },
  210: { id: 'global-10000000000', name: 'Ten Billion', type: 'global', global: true },
  211: { id: 'global-100000000000', name: 'One Hundred Billion', type: 'global', global: true },
  212: { id: 'global-1000000000000', name: 'One Trillion', type: 'global', global: true },
  213: { id: 'global-10000000000000', name: 'Ten Trillion', type: 'global', global: true },

  // Global 1/1 - Meme (220-229) - matches milestones-v2.csv
  220: { id: 'global-69', name: 'Nice', type: 'global', global: true },
  221: { id: 'global-420', name: 'Blaze It', type: 'global', global: true },
  222: { id: 'global-666', name: "Devil's Click", type: 'global', global: true },
  223: { id: 'global-777', name: 'Lucky Sevens', type: 'global', global: true },
  224: { id: 'global-1337', name: 'Elite', type: 'global', global: true },
  225: { id: 'global-42069', name: 'The Perfect Number', type: 'global', global: true },
  226: { id: 'global-69420', name: 'Ultra Nice', type: 'global', global: true },
  227: { id: 'global-8008135', name: 'Calculator Masterpiece', type: 'global', global: true },
  228: { id: 'global-8675309', name: 'Jenny', type: 'global', global: true },
  229: { id: 'global-42', name: 'Meaning of Everything', type: 'global', global: true },

  // Hidden personal - Meme (500-511)
  500: { id: 'nice', name: 'Nice', type: 'hidden' },
  501: { id: 'blaze-it', name: 'Blaze It', type: 'hidden' },
  502: { id: 'devils-click', name: "Devil's Click", type: 'hidden' },
  503: { id: 'lucky-7s', name: 'Lucky 7s', type: 'hidden' },
  504: { id: 'elite', name: 'Elite', type: 'hidden' },
  505: { id: 'calculator-word', name: 'Calculator Word', type: 'hidden' },
  506: { id: 'perfect-number', name: 'The Perfect Number', type: 'hidden' },
  507: { id: 'ultra-nice', name: 'Ultra Nice', type: 'hidden' },
  508: { id: 'old-school', name: 'Old School', type: 'hidden' },
  509: { id: 'double-blaze', name: 'Double Blaze', type: 'hidden' },
  510: { id: 'maximum-evil', name: 'Maximum Evil', type: 'hidden' },
  511: { id: 'nice-nice-nice', name: 'Nice Nice Nice', type: 'hidden' },

  // Hidden personal - Ones family (520-523)
  520: { id: 'triple-ones', name: 'Triple Ones', type: 'hidden' },
  521: { id: 'quad-ones', name: 'Quad Ones', type: 'hidden' },
  522: { id: 'make-a-wish', name: 'Make a Wish', type: 'hidden' },
  523: { id: 'six-ones', name: 'Six Ones', type: 'hidden' },

  // Hidden personal - Sevens family (524-526)
  524: { id: 'jackpot', name: 'Jackpot', type: 'hidden' },
  525: { id: 'mega-jackpot', name: 'Mega Jackpot', type: 'hidden' },
  526: { id: 'slot-machine-god', name: 'Slot Machine God', type: 'hidden' },

  // Hidden personal - Eights family (527-529)
  527: { id: 'prosperity', name: 'Prosperity', type: 'hidden' },
  528: { id: 'very-lucky', name: 'Very Lucky', type: 'hidden' },
  529: { id: 'fortune', name: 'Fortune', type: 'hidden' },

  // Hidden personal - Nines family (530-532)
  530: { id: 'so-close', name: 'So Close', type: 'hidden' },
  531: { id: 'edge-lord', name: 'Edge Lord', type: 'hidden' },
  532: { id: 'one-away', name: 'One Away', type: 'hidden' },

  // Hidden personal - Palindromes (540-545)
  540: { id: 'binary-palindrome', name: 'Binary Palindrome', type: 'hidden' },
  541: { id: 'bookends', name: 'Bookends', type: 'hidden' },
  542: { id: 'symmetric', name: 'Symmetric', type: 'hidden' },
  543: { id: 'counting-palindrome', name: 'Counting Palindrome', type: 'hidden' },
  544: { id: 'mirror-mirror', name: 'Mirror Mirror', type: 'hidden' },
  545: { id: 'the-mountain', name: 'The Mountain', type: 'hidden' },

  // Hidden personal - Mathematical (560-566)
  560: { id: 'fine-structure', name: 'Fine Structure', type: 'hidden' },
  561: { id: 'pi-day', name: 'Pi Day', type: 'hidden' },
  562: { id: 'golden', name: 'Golden', type: 'hidden' },
  563: { id: 'eulers-click', name: "Euler's Click", type: 'hidden' },
  564: { id: 'more-pi', name: 'More Pi', type: 'hidden' },
  565: { id: 'pi-squared', name: 'Pi Squared', type: 'hidden' },
  566: { id: 'full-pi', name: 'Full Pi', type: 'hidden' },

  // Hidden personal - Powers of 2 (580-588)
  580: { id: 'byte', name: 'Byte', type: 'hidden' },
  581: { id: 'half-k', name: 'Half K', type: 'hidden' },
  582: { id: 'kilobyte', name: 'Kilobyte', type: 'hidden' },
  583: { id: 'the-game', name: 'The Game', type: 'hidden' },
  584: { id: 'pow-2-12', name: '2^12', type: 'hidden' },
  585: { id: 'pow-2-13', name: '2^13', type: 'hidden' },
  586: { id: 'pow-2-14', name: '2^14', type: 'hidden' },
  587: { id: 'pow-2-15', name: '2^15', type: 'hidden' },
  588: { id: 'pow-2-16', name: '2^16', type: 'hidden' },

  // Hidden personal - Cultural (600-609)
  600: { id: 'not-found', name: 'Not Found', type: 'hidden' },
  601: { id: 'server-error', name: 'Server Error', type: 'hidden' },
  602: { id: 'jumbo', name: 'Jumbo', type: 'hidden' },
  603: { id: 'emergency', name: 'Emergency', type: 'hidden' },
  604: { id: 'orwellian', name: 'Orwellian', type: 'hidden' },
  605: { id: 'space-odyssey', name: 'Space Odyssey', type: 'hidden' },
  606: { id: 'end-times', name: 'End Times', type: 'hidden' },
  607: { id: 'love-you-3000', name: 'Love You 3000', type: 'hidden' },
  608: { id: 'meaning-of-everything', name: 'Meaning of Everything', type: 'hidden' },
  609: { id: 'seasons-of-love', name: 'Seasons of Love', type: 'hidden' },
};

// =============================================================================
// REDIS KEYS
// =============================================================================
const MILESTONES_KEY = (addr) => `clickstr:milestones:${addr.toLowerCase()}`;
const ACHIEVEMENTS_KEY = (addr) => `clickstr:achievements:${addr.toLowerCase()}`;
const NFT_CLAIMED_KEY = (addr) => `clickstr:nft-claimed:${addr.toLowerCase()}`; // Set of claimed tier numbers
const GLOBAL_MILESTONES_KEY = 'clickstr:global-milestones'; // Hash: milestoneId -> winner address
const V2_TOTAL_CLICKS_KEY = (addr) => `clickstr:v2:total:${addr.toLowerCase()}`; // V2 Redis clicks

// =============================================================================
// CLICK REGISTRY INTEGRATION
// =============================================================================

// Chain configuration
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '1');
const chain = CHAIN_ID === 1 ? mainnet : sepolia;

// ClickRegistry contract address (for reading lifetime clicks)
const REGISTRY_ADDRESS = process.env.CLICKSTR_REGISTRY_ADDRESS;

// Minimal ABI for reading totalClicks
const REGISTRY_ABI = [
  {
    name: 'totalClicks',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
];

/**
 * Get user's lifetime clicks from the ClickRegistry contract
 * Falls back to 0 if registry not configured or call fails
 */
async function getRegistryClicks(address) {
  if (!REGISTRY_ADDRESS) return 0n;

  try {
    const rpcUrl = process.env.RPC_URL || (CHAIN_ID === 1
      ? 'https://eth.llamarpc.com'
      : 'https://sepolia.infura.io/v3/your-key');

    const client = createPublicClient({
      chain,
      transport: http(rpcUrl)
    });

    const clicks = await client.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: 'totalClicks',
      args: [address]
    });
    return clicks;
  } catch (error) {
    console.error('Error reading registry clicks:', error);
    return 0n;
  }
}

// Click thresholds for personal milestones (must match TIER_INFO)
const PERSONAL_CLICK_THRESHOLDS = {
  1: 1,         // First Timer
  2: 100,       // Getting Started
  3: 500,       // Warming Up
  4: 1000,      // Dedicated
  5: 5000,      // Serious Clicker
  6: 10000,     // Obsessed
  7: 25000,     // No Sleep
  8: 50000,     // Touch Grass
  9: 100000,    // Legend
  10: 250000,   // Ascended
  11: 500000,   // Transcendent
  12: 1000000,  // Click God
};

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
    let totalClicks = 0;

    if (isGlobal || isStreak || isHidden) {
      // Check achievements key
      const achievements = await redis.smembers(ACHIEVEMENTS_KEY(addr)) || [];
      hasUnlocked = achievements.includes(milestoneId);
    } else if (isPersonal) {
      // For personal milestones, check BOTH Redis AND on-chain ClickRegistry
      // This enables cross-season eligibility - clicks from any season count

      // 1. Check if already marked as unlocked in Redis (V1 behavior)
      const milestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
      if (milestones.includes(milestoneId)) {
        hasUnlocked = true;
      } else {
        // 2. Check actual click counts from multiple sources
        const requiredClicks = PERSONAL_CLICK_THRESHOLDS[tier];

        // Get V1 clicks (from clickstr:clicks:{addr} hash)
        const v1Stats = await redis.hgetall(`clickstr:clicks:${addr}`) || {};
        const v1Clicks = parseInt(v1Stats?.totalClicks || '0', 10);

        // Get V2 Redis clicks (unclaimed current season)
        const v2RedisClicks = parseInt(await redis.get(V2_TOTAL_CLICKS_KEY(addr)) || '0', 10);

        // Get on-chain registry clicks (claimed across all seasons)
        const registryClicks = await getRegistryClicks(addr);

        // Total is: max of (v1 + v2 Redis) or registry, to avoid double-counting
        // Once clicks are claimed on-chain, they move to registry
        // Unclaimed clicks stay in Redis
        totalClicks = Math.max(v1Clicks + v2RedisClicks, Number(registryClicks));

        console.log(`[NFT Eligibility] ${addr} tier ${tier}: v1=${v1Clicks}, v2Redis=${v2RedisClicks}, registry=${registryClicks}, total=${totalClicks}, required=${requiredClicks}`);

        if (totalClicks >= requiredClicks) {
          hasUnlocked = true;
          // Auto-mark as unlocked in Redis for future checks
          await redis.sadd(MILESTONES_KEY(addr), milestoneId);
        }
      }
    }

    if (!hasUnlocked) {
      const requiredClicks = isPersonal ? PERSONAL_CLICK_THRESHOLDS[tier] : null;
      return res.status(403).json({
        error: 'Not eligible',
        message: `You haven't unlocked the "${TIER_INFO[tier]?.name || milestoneId}" milestone yet`,
        tier,
        milestone: milestoneId,
        ...(isPersonal && {
          currentClicks: totalClicks,
          requiredClicks,
          clicksNeeded: requiredClicks - totalClicks
        })
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
