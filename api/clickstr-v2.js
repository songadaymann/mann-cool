import { createHash, randomBytes } from 'crypto';
import { Redis } from '@upstash/redis';
import { keccak256, encodePacked, createPublicClient, http, recoverMessageAddress } from 'viem';
import { mainnet, sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

/**
 * Clickstr V2 - Off-Chain Click Tracking with On-Chain Settlement
 *
 * This is the V2 API that works with the new architecture:
 * - Clicks are validated off-chain (Turnstile + PoW)
 * - Clicks are stored in Redis
 * - Users claim rewards on-chain with server-signed attestations
 * - Clicks are recorded to the permanent ClickRegistry on-chain
 *
 * Key differences from V1:
 * - No on-chain submission of individual clicks (90%+ gas savings)
 * - Human-only via Turnstile verification (no bots)
 * - Server signs claim attestations for on-chain reward claims
 * - ClickRegistry tracks lifetime clicks across all seasons
 *
 * Endpoints:
 *   POST /api/clickstr-v2                     - Submit clicks (off-chain)
 *   POST /api/clickstr-v2 (action: "claim")   - Get signature to claim on-chain rewards
 *   POST /api/clickstr-v2 (heartbeat: true)   - Track active user session
 *   GET  /api/clickstr-v2?address=0x...       - Get player stats (Redis + Registry)
 *   GET  /api/clickstr-v2?claimable=true&address=0x... - Get claimable epochs
 *   GET  /api/clickstr-v2?leaderboard=true    - Get current epoch leaderboard
 *   GET  /api/clickstr-v2?activeUsers=true    - Get active user count + global clicks
 */

// =============================================================================
// CONFIGURATION
// =============================================================================

// Chain configuration
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '1'); // Default mainnet
const chain = CHAIN_ID === 1 ? mainnet : sepolia;

// Contract addresses (set via environment)
const GAME_CONTRACT_ADDRESS = process.env.CLICKSTR_GAME_V2_ADDRESS;
const REGISTRY_ADDRESS = process.env.CLICKSTR_REGISTRY_ADDRESS;

// ClickRegistry ABI (minimal for reading)
const REGISTRY_ABI = [
  {
    name: 'totalClicks',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'totalEarned',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'clicksPerSeason',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'season', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'globalTotalClicks',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  }
];

// ClickstrGameV2 ABI (minimal for reading)
const GAME_ABI = [
  {
    name: 'claimed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'epoch', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'getClaimedClicks',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'epoch', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'currentEpoch',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'SEASON_NUMBER',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'TOTAL_EPOCHS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'gameStarted',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'gameEnded',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }]
  },
  {
    name: 'EPOCH_DURATION',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    name: 'gameStartTime',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  }
];

// Proof-of-work difficulty configuration
// Starting difficulty (same as V1 default) - used when no Redis value exists yet
const DEFAULT_DIFFICULTY_TARGET = BigInt(process.env.POW_DIFFICULTY_TARGET || '0x00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_DIFFICULTY_TARGET = MAX_UINT256 / 10n;  // Easiest possible (~1/10 chance)
const MIN_DIFFICULTY_TARGET = 1000n;                 // Hardest possible
const MAX_ADJUSTMENT_FACTOR = 4n;                    // Max 4x change per epoch (same as V1)

// Difficulty Redis keys
const V2_DIFFICULTY_KEY = 'clickstr:v2:difficulty';
const V2_DIFFICULTY_EPOCH_KEY = 'clickstr:v2:difficulty-epoch';
const V2_DIFFICULTY_SEASON_KEY = 'clickstr:v2:difficulty-season'; // Tracks which season the difficulty belongs to

// Session configuration
const HUMAN_SESSION_DURATION = 60 * 60 * 1000; // 1 hour
const CLAIM_CHALLENGE_TTL_SECONDS = 60 * 5; // 5 minutes

// Rate limiting — bounds nonce throughput per address
// Frontend submits batches of 50-3000 nonces on button click; a human submits
// sporadically. An offline miner POSTs continuously. This caps total accepted
// nonces per sliding window to something human-plausible.
const RATE_LIMIT_WINDOW_SECONDS = 60; // 1-minute sliding window
const RATE_LIMIT_MAX_NONCES = parseInt(process.env.RATE_LIMIT_MAX_NONCES || '3000', 10); // max valid nonces per window

// =============================================================================
// REDIS KEYS (V2-specific, prefixed to avoid collision with V1)
// =============================================================================
const V2_CLICKS_KEY = (addr, epoch) => `clickstr:v2:clicks:${addr.toLowerCase()}:${epoch}`;
const V2_TOTAL_CLICKS_KEY = (addr) => `clickstr:v2:total:${addr.toLowerCase()}`;
const V2_EPOCH_LEADERBOARD_KEY = (epoch) => `clickstr:v2:leaderboard:${epoch}`;
const V2_EPOCH_TOTAL_KEY = (epoch) => `clickstr:v2:epoch-total:${epoch}`;
const V2_USED_NONCES_KEY = (addr, epoch) => `clickstr:v2:nonces:${addr.toLowerCase()}:${epoch}`;
const V2_CLAIM_ISSUED_KEY = (addr, epoch) => `clickstr:v2:claim-issued:${addr.toLowerCase()}:${epoch}`;
const V2_CLAIM_CHALLENGE_KEY = (addr, epoch) => `clickstr:v2:claim-challenge:${addr.toLowerCase()}:${epoch}`;
const HUMAN_SESSION_KEY = (addr) => `clickstr:human-session:${addr.toLowerCase()}`;
const ACTIVE_USERS_SET = 'clickstr:v2:active-users';
const V2_GLOBAL_CLICKS_KEY = 'clickstr:v2:global-clicks';
const V2_ALLTIME_LEADERBOARD_KEY = 'clickstr:v2:leaderboard:alltime';
const V2_EARNED_LEADERBOARD_KEY = 'clickstr:v2:leaderboard:earned';
const V2_RATE_LIMIT_KEY = (addr) => `clickstr:v2:ratelimit:${addr.toLowerCase()}`;

// Dashboard / analytics keys
const V2_DIFFICULTY_EVENTS_KEY = 'clickstr:v2:events:difficulty';     // Sorted set: score=timestamp, member=JSON
const V2_CLAIM_EVENTS_KEY = 'clickstr:v2:events:claims';             // Sorted set: score=timestamp, member=JSON
const V2_SNAPSHOT_KEY = (ts) => `clickstr:v2:snapshot:${ts}`;        // Point-in-time snapshot
const V2_SNAPSHOTS_INDEX_KEY = 'clickstr:v2:snapshots:index';        // Sorted set of snapshot timestamps
const V2_EPOCH_HISTORY_KEY = (season, epoch) => `clickstr:v2:history:epoch:${season}:${epoch}`;
const V2_CLICK_VELOCITY_KEY = 'clickstr:v2:velocity';                // Rolling click counter for velocity calc
const V2_LAST_SNAPSHOT_KEY = 'clickstr:v2:snapshots:last-ts';        // Timestamp of last snapshot
const V2_EPOCH_ATTESTED_KEY = (epoch) => `clickstr:v2:epoch-attested:${epoch}`; // Clicks with claim attestations issued

// =============================================================================
// BOT FLAGGING - Addresses identified as bots (manual list)
// These are filtered from normal leaderboard tabs and shown in a separate "Bots" tab
// =============================================================================
const FLAGGED_BOT_ADDRESSES = new Set([
  '0xd3a954764ee75f1df4142d853e70d2b7e5884d89',
  '0xdad91ea7b6acf1cedf3f374dfb73ffc1a5ae75e5',
  '0x74ac3770e1c8c1580ad04e98657da2975df6c689',
  '0x736f54a30eb7ba91a0f3486bbd7cb1dea338b6da',
  '0x455da13a80afe335f51bb4593421d81b8f86fc89',
]);

function isFlaggedBot(address) {
  return FLAGGED_BOT_ADDRESSES.has(address?.toLowerCase());
}

// Reuse V1 keys for cross-version compatibility
const CLICKS_KEY = (addr) => `clickstr:clicks:${addr.toLowerCase()}`;
const STREAK_KEY = (addr) => `clickstr:streak:${addr.toLowerCase()}`;
const MILESTONES_KEY = (addr) => `clickstr:milestones:${addr.toLowerCase()}`;
const ACHIEVEMENTS_KEY = (addr) => `clickstr:achievements:${addr.toLowerCase()}`;
const ELIGIBLE_KEY = 'clickstr:nft-eligible';
const GLOBAL_CLICKS_KEY = 'clickstr:global-clicks';
const GLOBAL_MILESTONES_KEY = 'clickstr:global-milestones';
const GLOBAL_TRIGGER_KEY = (globalClick) => `clickstr:global-trigger:${globalClick}`;
const CLICK_LOG_KEY = 'clickstr:click-log';

// =============================================================================
// MILESTONE DEFINITIONS (shared with V1)
// =============================================================================
const PERSONAL_MILESTONES = [
  { id: 'first-timer', tier: 1, clicks: 1, name: 'First Timer' },
  { id: 'getting-started', tier: 2, clicks: 100, name: 'Getting Started' },
  { id: 'warming-up', tier: 3, clicks: 500, name: 'Warming Up' },
  { id: 'dedicated', tier: 4, clicks: 1000, name: 'Dedicated' },
  { id: 'serious-clicker', tier: 5, clicks: 5000, name: 'Serious Clicker' },
  { id: 'obsessed', tier: 6, clicks: 10000, name: 'Obsessed' },
  { id: 'no-sleep', tier: 7, clicks: 25000, name: 'No Sleep' },
  { id: 'touch-grass', tier: 8, clicks: 50000, name: 'Touch Grass' },
  { id: 'legend', tier: 9, clicks: 100000, name: 'Legend' },
  { id: 'ascended', tier: 10, clicks: 250000, name: 'Ascended' },
  { id: 'transcendent', tier: 11, clicks: 500000, name: 'Transcendent' },
  { id: 'click-god', tier: 12, clicks: 1000000, name: 'Click God' },
];

// Global Milestones - first person to hit X OVERALL clicks wins (1/1 NFTs)
// Must match milestones-v2.csv and clickstr.js
const GLOBAL_MILESTONES = [
  // Main milestones (200-213)
  { id: 'global-1', tier: 200, globalClick: 1, name: 'The First Click' },
  { id: 'global-10', tier: 201, globalClick: 10, name: 'The Tenth' },
  { id: 'global-100', tier: 202, globalClick: 100, name: 'Century' },
  { id: 'global-1000', tier: 203, globalClick: 1000, name: 'Thousandaire' },
  { id: 'global-10000', tier: 204, globalClick: 10000, name: 'Ten Grand' },
  { id: 'global-100000', tier: 205, globalClick: 100000, name: 'The Hundred Thousandth' },
  { id: 'global-1000000', tier: 206, globalClick: 1000000, name: 'The Millionth Click' },
  { id: 'global-10000000', tier: 207, globalClick: 10000000, name: 'Ten Million' },
  { id: 'global-100000000', tier: 208, globalClick: 100000000, name: 'Hundred Million' },
  { id: 'global-1000000000', tier: 209, globalClick: 1000000000, name: 'Billionaire' },
  { id: 'global-10000000000', tier: 210, globalClick: 10000000000, name: 'Ten Billion' },
  { id: 'global-100000000000', tier: 211, globalClick: 100000000000, name: 'One Hundred Billion' },
  { id: 'global-1000000000000', tier: 212, globalClick: 1000000000000, name: 'One Trillion' },
  { id: 'global-10000000000000', tier: 213, globalClick: 10000000000000, name: 'Ten Trillion' },

  // Hidden global meme numbers (220-229)
  { id: 'global-69', tier: 220, globalClick: 69, name: 'Nice' },
  { id: 'global-420', tier: 221, globalClick: 420, name: 'Blaze It' },
  { id: 'global-666', tier: 222, globalClick: 666, name: "Devil's Click" },
  { id: 'global-777', tier: 223, globalClick: 777, name: 'Lucky Sevens' },
  { id: 'global-1337', tier: 224, globalClick: 1337, name: 'Elite' },
  { id: 'global-42069', tier: 225, globalClick: 42069, name: 'The Perfect Number' },
  { id: 'global-69420', tier: 226, globalClick: 69420, name: 'Ultra Nice' },
  { id: 'global-8008135', tier: 227, globalClick: 8008135, name: 'Calculator Masterpiece' },
  { id: 'global-8675309', tier: 228, globalClick: 8675309, name: 'Jenny' },
  { id: 'global-42', tier: 229, globalClick: 42, name: 'Meaning of Everything' },
];

// Hidden Achievements - triggered at specific personal click numbers
// Must match milestones-v2.csv and clickstr.js
const HIDDEN_ACHIEVEMENTS = [
  // Meme numbers (500-511)
  { id: 'nice', tier: 500, triggerClick: 69, name: 'Nice' },
  { id: 'blaze-it', tier: 501, triggerClick: 420, name: 'Blaze It' },
  { id: 'devils-click', tier: 502, triggerClick: 666, name: "Devil's Click" },
  { id: 'lucky-7s', tier: 503, triggerClick: 777, name: 'Lucky 7s' },
  { id: 'elite', tier: 504, triggerClick: 1337, name: 'Elite' },
  { id: 'calculator-word', tier: 505, triggerClick: 8008, name: 'Calculator Word' },
  { id: 'perfect-number', tier: 506, triggerClick: 42069, name: 'The Perfect Number' },
  { id: 'ultra-nice', tier: 507, triggerClick: 69420, name: 'Ultra Nice' },
  { id: 'old-school', tier: 508, triggerClick: 80085, name: 'Old School' },
  { id: 'double-blaze', tier: 509, triggerClick: 420420, name: 'Double Blaze' },
  { id: 'maximum-evil', tier: 510, triggerClick: 666666, name: 'Maximum Evil' },
  { id: 'nice-nice-nice', tier: 511, triggerClick: 696969, name: 'Nice Nice Nice' },

  // Ones family (520-523)
  { id: 'triple-ones', tier: 520, triggerClick: 111, name: 'Triple Ones' },
  { id: 'quad-ones', tier: 521, triggerClick: 1111, name: 'Quad Ones' },
  { id: 'make-a-wish', tier: 522, triggerClick: 11111, name: 'Make a Wish' },
  { id: 'six-ones', tier: 523, triggerClick: 111111, name: 'Six Ones' },

  // Sevens family (524-526)
  { id: 'jackpot', tier: 524, triggerClick: 7777, name: 'Jackpot' },
  { id: 'mega-jackpot', tier: 525, triggerClick: 77777, name: 'Mega Jackpot' },
  { id: 'slot-machine-god', tier: 526, triggerClick: 777777, name: 'Slot Machine God' },

  // Eights family (527-529)
  { id: 'prosperity', tier: 527, triggerClick: 888, name: 'Prosperity' },
  { id: 'very-lucky', tier: 528, triggerClick: 8888, name: 'Very Lucky' },
  { id: 'fortune', tier: 529, triggerClick: 888888, name: 'Fortune' },

  // Nines family (530-532)
  { id: 'so-close', tier: 530, triggerClick: 999, name: 'So Close' },
  { id: 'edge-lord', tier: 531, triggerClick: 9999, name: 'Edge Lord' },
  { id: 'one-away', tier: 532, triggerClick: 999999, name: 'One Away' },

  // Palindromes (540-545)
  { id: 'binary-palindrome', tier: 540, triggerClick: 101, name: 'Binary Palindrome' },
  { id: 'bookends', tier: 541, triggerClick: 1001, name: 'Bookends' },
  { id: 'symmetric', tier: 542, triggerClick: 10001, name: 'Symmetric' },
  { id: 'counting-palindrome', tier: 543, triggerClick: 12321, name: 'Counting Palindrome' },
  { id: 'mirror-mirror', tier: 544, triggerClick: 123321, name: 'Mirror Mirror' },
  { id: 'the-mountain', tier: 545, triggerClick: 1234321, name: 'The Mountain' },

  // Mathematical (560-566)
  { id: 'fine-structure', tier: 560, triggerClick: 137, name: 'Fine Structure' },
  { id: 'pi-day', tier: 561, triggerClick: 314, name: 'Pi Day' },
  { id: 'golden', tier: 562, triggerClick: 1618, name: 'Golden' },
  { id: 'eulers-click', tier: 563, triggerClick: 2718, name: "Euler's Click" },
  { id: 'more-pi', tier: 564, triggerClick: 3141, name: 'More Pi' },
  { id: 'pi-squared', tier: 565, triggerClick: 31415, name: 'Pi Squared' },
  { id: 'full-pi', tier: 566, triggerClick: 314159, name: 'Full Pi' },

  // Powers of 2 (580-588)
  { id: 'byte', tier: 580, triggerClick: 256, name: 'Byte' },
  { id: 'half-k', tier: 581, triggerClick: 512, name: 'Half K' },
  { id: 'kilobyte', tier: 582, triggerClick: 1024, name: 'Kilobyte' },
  { id: 'the-game', tier: 583, triggerClick: 2048, name: 'The Game' },
  { id: 'pow-2-12', tier: 584, triggerClick: 4096, name: '2^12' },
  { id: 'pow-2-13', tier: 585, triggerClick: 8192, name: '2^13' },
  { id: 'pow-2-14', tier: 586, triggerClick: 16384, name: '2^14' },
  { id: 'pow-2-15', tier: 587, triggerClick: 32768, name: '2^15' },
  { id: 'pow-2-16', tier: 588, triggerClick: 65536, name: '2^16' },

  // Cultural (600-609)
  { id: 'not-found', tier: 600, triggerClick: 404, name: 'Not Found' },
  { id: 'server-error', tier: 601, triggerClick: 500, name: 'Server Error' },
  { id: 'jumbo', tier: 602, triggerClick: 747, name: 'Jumbo' },
  { id: 'emergency', tier: 603, triggerClick: 911, name: 'Emergency' },
  { id: 'orwellian', tier: 604, triggerClick: 1984, name: 'Orwellian' },
  { id: 'space-odyssey', tier: 605, triggerClick: 2001, name: 'Space Odyssey' },
  { id: 'end-times', tier: 606, triggerClick: 2012, name: 'End Times' },
  { id: 'love-you-3000', tier: 607, triggerClick: 3000, name: 'Love You 3000' },
  { id: 'meaning-of-everything', tier: 608, triggerClick: 42, name: 'Meaning of Everything' },
  { id: 'seasons-of-love', tier: 609, triggerClick: 525600, name: 'Seasons of Love' },
];

// Streak Achievements
// tier = NFT token ID (101-103 for streak achievements)
const STREAK_ACHIEVEMENTS = [
  { id: 'week-warrior', tier: 101, days: 7, name: 'Week Warrior', description: 'Clicked 7 days in a row' },
  { id: 'month-master', tier: 102, days: 30, name: 'Month Master', description: 'Clicked 30 days in a row' },
  { id: 'perfect-attendance', tier: 103, days: 90, name: 'Perfect Attendance', description: 'Clicked all 90 days' },
];

// Epoch-Based Achievements
// tier = NFT token ID (104-105 for epoch achievements)
const EPOCH_ACHIEVEMENTS = [
  { id: 'day-one-og', tier: 104, epoch: 1, name: 'Day One OG', description: 'Clicked during epoch 1' },
  { id: 'final-day', tier: 105, epoch: 90, name: 'The Final Day', description: 'Clicked during epoch 90' },
];

// =============================================================================
// HELPERS
// =============================================================================

function validateAddress(address) {
  return address && /^0x[a-fA-F0-9]{40}$/.test(address);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0];
  }
  return req.socket?.remoteAddress || '';
}

function hashIp(ip) {
  if (!ip) return '';
  const salt = process.env.TURNSTILE_IP_SALT || '';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

/**
 * Create a viem public client for reading from contracts
 */
function getPublicClient() {
  const rpcUrl = process.env.RPC_URL || (CHAIN_ID === 1
    ? 'https://eth.llamarpc.com'
    : 'https://sepolia.infura.io/v3/your-key');

  return createPublicClient({
    chain,
    transport: http(rpcUrl)
  });
}

/**
 * Get user's lifetime clicks from the ClickRegistry contract
 */
async function getRegistryClicks(address) {
  if (!REGISTRY_ADDRESS) return 0n;

  try {
    const client = getPublicClient();
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

/**
 * Get user's lifetime earnings from the ClickRegistry contract
 */
async function getRegistryEarned(address) {
  if (!REGISTRY_ADDRESS) return 0n;

  try {
    const client = getPublicClient();
    const earned = await client.readContract({
      address: REGISTRY_ADDRESS,
      abi: REGISTRY_ABI,
      functionName: 'totalEarned',
      args: [address]
    });
    return earned;
  } catch (error) {
    console.error('Error reading registry earned:', error);
    return 0n;
  }
}

/**
 * Check if user has already claimed on-chain for an epoch
 */
async function hasClaimedOnChain(address, epoch) {
  if (!GAME_CONTRACT_ADDRESS) return false;

  try {
    const client = getPublicClient();
    const claimed = await client.readContract({
      address: GAME_CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: 'claimed',
      args: [address, BigInt(epoch)]
    });
    return claimed;
  } catch (error) {
    console.error('Error checking claim status:', error);
    return false;
  }
}

/**
 * Get the number of clicks already claimed on-chain for an epoch
 * Used for incremental claims - returns uint256, not boolean
 */
async function getClaimedClicksOnChain(address, epoch) {
  if (!GAME_CONTRACT_ADDRESS) return 0;

  try {
    const client = getPublicClient();
    const claimedClicks = await client.readContract({
      address: GAME_CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: 'getClaimedClicks',
      args: [address, BigInt(epoch)]
    });
    return Number(claimedClicks);
  } catch (error) {
    console.error('Error getting claimed clicks:', error);
    return 0;
  }
}

/**
 * Get current game state from contract
 */
async function getGameState() {
  if (!GAME_CONTRACT_ADDRESS) {
    return { currentEpoch: 1, seasonNumber: 2, totalEpochs: 3, epochDuration: 14400, gameStarted: false, gameEnded: false };
  }

  try {
    const client = getPublicClient();
    const [currentEpoch, seasonNumber, totalEpochs, gameStarted, gameEnded, epochDuration, gameStartTime] = await Promise.all([
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'currentEpoch' }),
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'SEASON_NUMBER' }),
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'TOTAL_EPOCHS' }),
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'gameStarted' }),
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'gameEnded' }),
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'EPOCH_DURATION' }),
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'gameStartTime' }),
    ]);

    // Compute time-based epoch (mirrors contract's _checkAndAdvanceEpoch logic).
    // The on-chain currentEpoch is stale until someone transacts, so we derive the
    // real epoch from wall-clock time to avoid signing for already-finalized epochs.
    let effectiveEpoch = Number(currentEpoch);
    let effectiveGameEnded = gameEnded;
    if (gameStarted && !gameEnded && Number(gameStartTime) > 0) {
      const now = Math.floor(Date.now() / 1000);
      const epochsSinceStart = Math.floor((now - Number(gameStartTime)) / Number(epochDuration));
      const targetEpoch = Math.min(epochsSinceStart + 1, Number(totalEpochs));
      if (targetEpoch > effectiveEpoch) {
        effectiveEpoch = targetEpoch;
      }
      // Derive gameEnded from time — the on-chain flag only flips when someone
      // calls endGame() after the grace period, but the game is effectively over
      // once all epochs have elapsed.
      const gameEndTime = Number(gameStartTime) + Number(totalEpochs) * Number(epochDuration);
      if (now >= gameEndTime) {
        effectiveGameEnded = true;
      }
    }

    return {
      currentEpoch: effectiveEpoch,
      seasonNumber: Number(seasonNumber),
      totalEpochs: Number(totalEpochs),
      epochDuration: Number(epochDuration),
      gameStarted,
      gameEnded: effectiveGameEnded
    };
  } catch (error) {
    console.error('Error reading game state:', error);
    return { currentEpoch: 1, seasonNumber: 2, totalEpochs: 3, epochDuration: 14400, gameStarted: false, gameEnded: false };
  }
}

/**
 * Verify a proof-of-work nonce against a given difficulty target
 */
function verifyNonce(address, nonceStr, epoch, difficultyTarget) {
  try {
    const nonce = BigInt(nonceStr);
    const packed = encodePacked(
      ['address', 'uint256', 'uint256', 'uint256'],
      [address, nonce, BigInt(epoch), BigInt(CHAIN_ID)]
    );
    const hash = keccak256(packed);
    const hashBigInt = BigInt(hash);
    return hashBigInt < difficultyTarget;
  } catch (error) {
    console.error('Nonce verification error:', error);
    return false;
  }
}

// =============================================================================
// DIFFICULTY ADJUSTMENT (Bitcoin-style, ported from V1 on-chain logic)
// =============================================================================

/**
 * Read current difficulty target from Redis (or return default)
 */
async function getCurrentDifficulty(redis) {
  const stored = await redis.get(V2_DIFFICULTY_KEY);
  if (stored) return BigInt(stored);
  return DEFAULT_DIFFICULTY_TARGET;
}

/**
 * Calculate new difficulty based on actual vs target ATTESTED clicks for an epoch.
 *
 * Difficulty is driven by claim attestations, NOT raw mining clicks.
 * This means bots that mine but never claim have ZERO effect on difficulty.
 * The goal: distribute ~1M $CLICK per epoch. If claims are high, slow it down.
 * If claims are low, speed it up.
 *
 * - More attested clicks than target → lower target (harder, slower mining)
 * - Fewer attested clicks than target → higher target (easier, faster mining)
 * - Zero attested clicks → 4x easier
 * - Capped at 4x change per epoch in either direction
 */
function calculateNewDifficulty(currentTarget, actualClicks, targetClicks) {
  if (actualClicks === 0n) {
    // No attested clicks at all — make 4x easier (raise target)
    let newTarget = currentTarget * MAX_ADJUSTMENT_FACTOR;
    if (newTarget > MAX_DIFFICULTY_TARGET) newTarget = MAX_DIFFICULTY_TARGET;
    return newTarget;
  }

  // newTarget = currentTarget * targetClicks / actualClicks
  // If actual > target: ratio < 1 → newTarget < currentTarget (harder)
  // If actual < target: ratio > 1 → newTarget > currentTarget (easier)
  let newTarget = (currentTarget * targetClicks) / actualClicks;

  // Cap at 4x change in either direction
  if (newTarget > currentTarget * MAX_ADJUSTMENT_FACTOR) {
    newTarget = currentTarget * MAX_ADJUSTMENT_FACTOR;
  }
  if (newTarget < currentTarget / MAX_ADJUSTMENT_FACTOR) {
    newTarget = currentTarget / MAX_ADJUSTMENT_FACTOR;
  }

  // Enforce absolute bounds
  if (newTarget > MAX_DIFFICULTY_TARGET) newTarget = MAX_DIFFICULTY_TARGET;
  if (newTarget < MIN_DIFFICULTY_TARGET) newTarget = MIN_DIFFICULTY_TARGET;

  return newTarget;
}

/**
 * Check if difficulty needs adjustment for the current epoch.
 * Adjusts based on completed epochs' ATTESTED click counts (claims only).
 * Raw mining clicks are ignored — only clicks with claim attestations count.
 * Returns the current difficulty target.
 */
async function adjustDifficultyIfNeeded(redis, gameState) {
  const { currentEpoch, epochDuration, gameStarted, seasonNumber } = gameState;

  // No adjustment needed if game hasn't started or epoch 0
  if (!gameStarted || !currentEpoch || currentEpoch < 1) {
    return await getCurrentDifficulty(redis);
  }

  // Detect season change — if season number differs from what's stored,
  // reset the epoch tracking key so difficulty adjustment runs fresh.
  // The difficulty VALUE itself is preserved (carry-over by default).
  const storedSeason = parseInt(await redis.get(V2_DIFFICULTY_SEASON_KEY) || '0', 10);
  if (seasonNumber && seasonNumber !== storedSeason) {
    console.log(`[Difficulty] New season detected: ${storedSeason} → ${seasonNumber}. Resetting epoch tracking.`);
    await redis.set(V2_DIFFICULTY_SEASON_KEY, seasonNumber.toString());
    await redis.set(V2_DIFFICULTY_EPOCH_KEY, '0');
  }

  const difficultySetForEpoch = parseInt(await redis.get(V2_DIFFICULTY_EPOCH_KEY) || '0', 10);

  // Already adjusted for this epoch
  if (currentEpoch <= difficultySetForEpoch) {
    return await getCurrentDifficulty(redis);
  }

  let difficulty = await getCurrentDifficulty(redis);

  // If first time (or after season reset), initialize for epoch 1
  if (difficultySetForEpoch === 0) {
    await redis.set(V2_DIFFICULTY_KEY, difficulty.toString());
    await redis.set(V2_DIFFICULTY_EPOCH_KEY, '1');
    if (currentEpoch === 1) return difficulty;
  }

  // Target clicks per epoch — same formula as the V2 contract's _calculateReward:
  //   targetClicks = (1_000_000 * EPOCH_DURATION) / 86400
  const targetClicksPerEpoch = BigInt(Math.floor(1_000_000 * epochDuration / 86400));

  // Adjust for each completed epoch since last adjustment
  // e.g. difficulty set for epoch 1, now in epoch 3 → adjust based on epochs 1, 2
  const startFrom = Math.max(difficultySetForEpoch, 1);
  const maxIterations = 5; // Safety cap
  let iterations = 0;

  for (let completedEpoch = startFrom; completedEpoch < currentEpoch && iterations < maxIterations; completedEpoch++) {
    // Use ATTESTED clicks (claims only) instead of raw mining clicks.
    // This means bots that mine but never claim don't inflate difficulty.
    const attestedClicks = parseInt(await redis.get(V2_EPOCH_ATTESTED_KEY(completedEpoch)) || '0', 10);
    const rawClicks = parseInt(await redis.get(V2_EPOCH_TOTAL_KEY(completedEpoch)) || '0', 10);
    const oldDifficulty = difficulty;
    difficulty = calculateNewDifficulty(difficulty, BigInt(attestedClicks), targetClicksPerEpoch);
    console.log(
      `[Difficulty] Epoch ${completedEpoch}: ${attestedClicks} attested clicks (${rawClicks} raw, target: ${targetClicksPerEpoch}) → ` +
      `difficulty 0x${oldDifficulty.toString(16).substring(0, 8)}... → 0x${difficulty.toString(16).substring(0, 8)}...`
    );

    // Log difficulty change event for dashboard history
    const diffEvent = JSON.stringify({
      ts: Date.now(),
      season: seasonNumber,
      epoch: completedEpoch,
      oldDifficulty: '0x' + oldDifficulty.toString(16),
      newDifficulty: '0x' + difficulty.toString(16),
      attestedClicks,
      rawClicks,
      targetClicks: Number(targetClicksPerEpoch),
    });
    await redis.zadd(V2_DIFFICULTY_EVENTS_KEY, { score: Date.now(), member: diffEvent });

    iterations++;
  }

  // Store updated difficulty for current epoch
  await redis.set(V2_DIFFICULTY_KEY, difficulty.toString());
  await redis.set(V2_DIFFICULTY_EPOCH_KEY, currentEpoch.toString());

  return difficulty;
}

// =============================================================================
// DASHBOARD SNAPSHOT SYSTEM
// =============================================================================

const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SNAPSHOT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days retention
const SNAPSHOTS_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days in ms

/**
 * Take a point-in-time snapshot of all key metrics.
 * Called lazily on API requests if >5 min since last snapshot.
 */
async function maybeSnapshot(redis, gameState) {
  try {
    const now = Date.now();
    const lastTs = parseInt(await redis.get(V2_LAST_SNAPSHOT_KEY) || '0', 10);
    if (now - lastTs < SNAPSHOT_INTERVAL_MS) return; // Too soon

    const { currentEpoch, seasonNumber, totalEpochs, epochDuration, gameStarted, gameEnded } = gameState;
    const gameActive = gameStarted && !gameEnded;

    // Gather metrics
    const [
      difficultyRaw,
      epochClicksRaw,
      globalClicksRaw,
      activeCount,
      velocityRaw,
    ] = await Promise.all([
      redis.get(V2_DIFFICULTY_KEY),
      redis.get(V2_EPOCH_TOTAL_KEY(currentEpoch)),
      redis.get(V2_GLOBAL_CLICKS_KEY),
      redis.zcount(ACTIVE_USERS_SET, now - 60000, '+inf'),
      redis.get(V2_CLICK_VELOCITY_KEY),
    ]);

    // Count bot clicks
    let botClicks = 0;
    const botTotals = await Promise.all(
      Array.from(FLAGGED_BOT_ADDRESSES).map(addr => redis.get(V2_TOTAL_CLICKS_KEY(addr)))
    );
    for (const total of botTotals) botClicks += parseInt(total || '0', 10);

    // Count unique clickers this epoch from leaderboard
    const uniqueClickers = await redis.zcard(V2_EPOCH_LEADERBOARD_KEY(currentEpoch));

    // Get earned total
    let globalEarnedWei = '0';
    try {
      const earnedEntries = await redis.zrange(V2_EARNED_LEADERBOARD_KEY, 0, -1, { withScores: true });
      let totalWei = BigInt(0);
      for (let i = 0; i < earnedEntries.length; i += 2) {
        try {
          const raw = earnedEntries[i];
          const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
          const score = BigInt(Math.floor(earnedEntries[i + 1]));
          if (!FLAGGED_BOT_ADDRESSES.has(data.address?.toLowerCase())) {
            totalWei += score;
          }
        } catch { /* skip */ }
      }
      globalEarnedWei = totalWei.toString();
    } catch { /* non-critical */ }

    const snapshot = {
      ts: now,
      season: seasonNumber,
      epoch: currentEpoch,
      gameActive,
      difficulty: difficultyRaw || DEFAULT_DIFFICULTY_TARGET.toString(),
      epochClicks: parseInt(epochClicksRaw || '0', 10),
      globalClicks: parseInt(globalClicksRaw || '0', 10),
      botClicks,
      humanClicks: Math.max(0, parseInt(globalClicksRaw || '0', 10) - botClicks),
      activeUsers: activeCount || 0,
      uniqueClickers: uniqueClickers || 0,
      globalEarnedWei,
      clicksPerMin: parseInt(velocityRaw || '0', 10),
    };

    // Store snapshot
    const tsKey = Math.floor(now / 1000); // second-precision key
    await Promise.all([
      redis.set(V2_SNAPSHOT_KEY(tsKey), JSON.stringify(snapshot), { ex: SNAPSHOT_TTL_SECONDS }),
      redis.zadd(V2_SNAPSHOTS_INDEX_KEY, { score: now, member: String(tsKey) }),
      redis.set(V2_LAST_SNAPSHOT_KEY, String(now)),
    ]);

    // Prune old snapshot index entries (beyond 30 days)
    const cutoff = now - SNAPSHOTS_MAX_AGE;
    const oldKeys = await redis.zrange(V2_SNAPSHOTS_INDEX_KEY, 0, cutoff, { byScore: true });
    if (oldKeys.length > 0) {
      await redis.zrem(V2_SNAPSHOTS_INDEX_KEY, ...oldKeys);
    }

    console.log(`[Snapshot] Captured at ${new Date(now).toISOString()} — epoch ${currentEpoch}, ${snapshot.activeUsers} active, ${snapshot.epochClicks} epoch clicks`);
  } catch (err) {
    console.error('[Snapshot] Error:', err.message);
    // Non-fatal — don't break the request
  }
}

/**
 * Track click velocity — called on each successful click submission.
 * Stores clicks-per-minute using a simple rolling window.
 */
async function trackClickVelocity(redis, clickCount) {
  try {
    const now = Date.now();
    // Use a sorted set with timestamp scores; members are click counts
    const velocityWindowKey = 'clickstr:v2:velocity-window';
    await redis.zadd(velocityWindowKey, { score: now, member: `${now}:${clickCount}` });
    // Remove entries older than 60 seconds
    const oldEntries = await redis.zrange(velocityWindowKey, 0, now - 60000, { byScore: true });
    if (oldEntries.length > 0) await redis.zrem(velocityWindowKey, ...oldEntries);
    // Sum all entries in the window for clicks-per-minute
    const entries = await redis.zrange(velocityWindowKey, 0, -1);
    let totalInWindow = 0;
    for (const entry of entries) {
      const parts = entry.split(':');
      totalInWindow += parseInt(parts[1] || '0', 10);
    }
    await redis.set(V2_CLICK_VELOCITY_KEY, totalInWindow);
  } catch { /* non-critical */ }
}

/**
 * Verify Cloudflare Turnstile token
 */
async function verifyTurnstile(token) {
  if (!process.env.TURNSTILE_SECRET_KEY) {
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
    return { success: data.success, error: data.success ? null : 'Verification failed' };
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return { success: false, error: 'Verification service error' };
  }
}

/**
 * Sign a claim attestation for on-chain reward claim
 * Message format: keccak256(address, epoch, clickCount, seasonNumber, contractAddress, chainId)
 */
async function signClaimAttestation(address, epoch, clickCount, seasonNumber) {
  if (!process.env.ATTESTATION_SIGNER_PRIVATE_KEY) {
    throw new Error('Attestation signer not configured');
  }

  const account = privateKeyToAccount(process.env.ATTESTATION_SIGNER_PRIVATE_KEY);

  const messageHash = keccak256(
    encodePacked(
      ['address', 'uint256', 'uint256', 'uint256', 'address', 'uint256'],
      [
        address,
        BigInt(epoch),
        BigInt(clickCount),
        BigInt(seasonNumber),
        GAME_CONTRACT_ADDRESS,
        BigInt(CHAIN_ID)
      ]
    )
  );

  // Sign with EIP-191 personal sign
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
    // =========================================================================
    // GET REQUESTS
    // =========================================================================
    if (req.method === 'GET') {
      const { address, leaderboard, claimable, activeUsers, syncAchievements, difficulty: difficultyQuery, epoch: queryEpoch, limit = '50', type: leaderboardType, dashboard, history } = req.query;

      // Get current game state
      const gameState = await getGameState();

      // Lazily capture a snapshot (self-throttles to every 5 min)
      maybeSnapshot(redis, gameState).catch(() => {});

      // Debug: show server env config (temporary)
      if (req.query.debug === 'env') {
        return res.status(200).json({
          CHAIN_ID,
          chainName: chain?.name,
          GAME_CONTRACT_ADDRESS,
          REGISTRY_ADDRESS,
          RPC_URL: process.env.RPC_URL ? process.env.RPC_URL.slice(0, 40) + '...' : 'NOT SET',
          gameState,
        });
      }

      // =====================================================================
      // DASHBOARD — comprehensive admin stats
      // GET /api/clickstr-v2?dashboard=true&range=24h|7d|30d
      // =====================================================================
      if (dashboard === 'true') {
        const range = req.query.range || '24h';
        const rangeMs = range === '30d' ? 30*24*60*60*1000
                      : range === '7d'  ? 7*24*60*60*1000
                      : 24*60*60*1000;
        const now = Date.now();
        const from = now - rangeMs;

        // 1. Current state
        const gameActive = gameState.gameStarted && !gameState.gameEnded;
        const currentDifficulty = gameActive
          ? await adjustDifficultyIfNeeded(redis, gameState)
          : MAX_DIFFICULTY_TARGET;
        const targetClicksPerEpoch = Math.floor(1_000_000 * gameState.epochDuration / 86400);
        const [epochClicksRaw, globalClicksRaw, activeCount, velocityRaw, epochAttestedRaw] = await Promise.all([
          redis.get(V2_EPOCH_TOTAL_KEY(gameState.currentEpoch)),
          redis.get(V2_GLOBAL_CLICKS_KEY),
          redis.zcount(ACTIVE_USERS_SET, now - 60000, '+inf'),
          redis.get(V2_CLICK_VELOCITY_KEY),
          redis.get(V2_EPOCH_ATTESTED_KEY(gameState.currentEpoch)),
        ]);
        const epochClicks = parseInt(epochClicksRaw || '0', 10);
        const globalClicks = parseInt(globalClicksRaw || '0', 10);
        const epochAttested = parseInt(epochAttestedRaw || '0', 10);

        // Bot stats
        let botClicks = 0;
        const botTotals = await Promise.all(
          Array.from(FLAGGED_BOT_ADDRESSES).map(addr => redis.get(V2_TOTAL_CLICKS_KEY(addr)))
        );
        for (const total of botTotals) botClicks += parseInt(total || '0', 10);

        // Earned total
        let globalEarnedWei = '0';
        try {
          const earnedEntries = await redis.zrange(V2_EARNED_LEADERBOARD_KEY, 0, -1, { withScores: true });
          let totalWei = BigInt(0);
          for (let i = 0; i < earnedEntries.length; i += 2) {
            try {
              const raw = earnedEntries[i];
              const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const score = BigInt(Math.floor(earnedEntries[i + 1]));
              if (!FLAGGED_BOT_ADDRESSES.has(data.address?.toLowerCase())) totalWei += score;
            } catch { /* skip */ }
          }
          globalEarnedWei = totalWei.toString();
        } catch { /* non-critical */ }

        // Unique clickers this epoch
        const uniqueClickers = await redis.zcard(V2_EPOCH_LEADERBOARD_KEY(gameState.currentEpoch));

        // 2. Time-series snapshots
        const snapshotKeys = await redis.zrange(V2_SNAPSHOTS_INDEX_KEY, from, now, { byScore: true });
        const snapshots = [];
        if (snapshotKeys.length > 0) {
          // Batch fetch snapshots (limit to 500 for sanity)
          const keysToFetch = snapshotKeys.slice(-500);
          const snapshotData = await Promise.all(
            keysToFetch.map(tsKey => redis.get(V2_SNAPSHOT_KEY(tsKey)))
          );
          for (const raw of snapshotData) {
            if (!raw) continue;
            try {
              const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
              snapshots.push(s);
            } catch { /* skip */ }
          }
        }

        // 3. Difficulty events
        const diffEvents = await redis.zrange(V2_DIFFICULTY_EVENTS_KEY, from, now, { byScore: true });
        const difficultyHistory = diffEvents.map(e => {
          try { return typeof e === 'string' ? JSON.parse(e) : e; } catch { return null; }
        }).filter(Boolean);

        // 4. Claim events
        const claimEvents = await redis.zrange(V2_CLAIM_EVENTS_KEY, from, now, { byScore: true });
        const claimHistory = claimEvents.map(e => {
          try { return typeof e === 'string' ? JSON.parse(e) : e; } catch { return null; }
        }).filter(Boolean);

        // 5. Per-epoch data (all epochs for current season)
        const epochs = [];
        for (let ep = 1; ep <= gameState.totalEpochs; ep++) {
          const [epClicksRaw, epAttestedRaw, epUnique, historyRaw] = await Promise.all([
            redis.get(V2_EPOCH_TOTAL_KEY(ep)),
            redis.get(V2_EPOCH_ATTESTED_KEY(ep)),
            redis.zcard(V2_EPOCH_LEADERBOARD_KEY(ep)),
            redis.get(V2_EPOCH_HISTORY_KEY(gameState.seasonNumber, ep)),
          ]);
          const epClicks = parseInt(epClicksRaw || '0', 10);
          const epAttested = parseInt(epAttestedRaw || '0', 10);
          let history = null;
          if (historyRaw) {
            try { history = typeof historyRaw === 'string' ? JSON.parse(historyRaw) : historyRaw; } catch {}
          }
          epochs.push({
            epoch: ep,
            status: ep < gameState.currentEpoch ? 'completed' : ep === gameState.currentEpoch ? 'active' : 'upcoming',
            totalClicks: epClicks,
            attestedClicks: epAttested,
            targetClicks: targetClicksPerEpoch,
            uniquePlayers: epUnique || 0,
            history,
          });
        }

        return res.status(200).json({
          success: true,
          currentState: {
            season: gameState.seasonNumber,
            epoch: gameState.currentEpoch,
            totalEpochs: gameState.totalEpochs,
            epochDuration: gameState.epochDuration,
            gameActive,
            difficulty: '0x' + currentDifficulty.toString(16),
            defaultDifficulty: '0x' + DEFAULT_DIFFICULTY_TARGET.toString(16),
            difficultyRatio: Number(DEFAULT_DIFFICULTY_TARGET / currentDifficulty).toFixed(2),
            epochClicks,
            epochAttestedClicks: epochAttested,
            targetClicksPerEpoch,
            epochProgress: ((epochClicks / targetClicksPerEpoch) * 100).toFixed(1),
            attestedProgress: ((epochAttested / targetClicksPerEpoch) * 100).toFixed(1),
            globalClicks,
            botClicks,
            humanClicks: Math.max(0, globalClicks - botClicks),
            botPercentage: globalClicks > 0 ? ((botClicks / globalClicks) * 100).toFixed(1) : '0',
            activeUsers: activeCount || 0,
            uniqueClickers: uniqueClickers || 0,
            clicksPerMin: parseInt(velocityRaw || '0', 10),
            globalEarnedWei,
            flaggedBots: Array.from(FLAGGED_BOT_ADDRESSES),
          },
          epochs,
          timeseries: snapshots,
          difficultyHistory,
          claimHistory,
          range,
          gameState,
        });
      }

      // =====================================================================
      // HISTORY — targeted historical data queries
      // GET /api/clickstr-v2?history=snapshots|difficulty|claims&from=TS&to=TS
      // =====================================================================
      if (history) {
        const from = parseInt(req.query.from || '0', 10) || (Date.now() - 24*60*60*1000);
        const to = parseInt(req.query.to || '0', 10) || Date.now();

        if (history === 'snapshots') {
          const keys = await redis.zrange(V2_SNAPSHOTS_INDEX_KEY, from, to, { byScore: true });
          const data = [];
          for (const tsKey of keys.slice(-1000)) {
            const raw = await redis.get(V2_SNAPSHOT_KEY(tsKey));
            if (raw) {
              try { data.push(typeof raw === 'string' ? JSON.parse(raw) : raw); } catch {}
            }
          }
          return res.status(200).json({ success: true, type: 'snapshots', from, to, data });
        }

        if (history === 'difficulty') {
          const events = await redis.zrange(V2_DIFFICULTY_EVENTS_KEY, from, to, { byScore: true });
          const data = events.map(e => {
            try { return typeof e === 'string' ? JSON.parse(e) : e; } catch { return null; }
          }).filter(Boolean);
          return res.status(200).json({ success: true, type: 'difficulty', from, to, data });
        }

        if (history === 'claims') {
          const events = await redis.zrange(V2_CLAIM_EVENTS_KEY, from, to, { byScore: true });
          const data = events.map(e => {
            try { return typeof e === 'string' ? JSON.parse(e) : e; } catch { return null; }
          }).filter(Boolean);
          return res.status(200).json({ success: true, type: 'claims', from, to, data });
        }

        return res.status(400).json({ error: 'Invalid history type. Use: snapshots, difficulty, claims' });
      }

      // Difficulty request — returns current PoW target for mining
      if (difficultyQuery === 'true') {
        const gameActive = gameState.gameStarted && !gameState.gameEnded;
        const currentDifficulty = gameActive
          ? await adjustDifficultyIfNeeded(redis, gameState)
          : MAX_DIFFICULTY_TARGET;
        const targetClicksPerEpoch = Math.floor(1_000_000 * gameState.epochDuration / 86400);
        const currentEpochClicks = parseInt(
          await redis.get(V2_EPOCH_TOTAL_KEY(gameState.currentEpoch)) || '0', 10
        );
        const currentEpochAttested = parseInt(
          await redis.get(V2_EPOCH_ATTESTED_KEY(gameState.currentEpoch)) || '0', 10
        );

        return res.status(200).json({
          success: true,
          difficultyTarget: '0x' + currentDifficulty.toString(16),
          epoch: gameState.currentEpoch,
          targetClicksPerEpoch,
          currentEpochClicks,
          currentEpochAttested,
          gameActive,
        });
      }

      // Leaderboard request
      if (leaderboard === 'true') {
        const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
        const isBotTab = leaderboardType === 'bots';

        // Determine which sorted set to query based on type
        // For bots tab, we use the alltime leaderboard and filter TO bots only
        let redisKey;
        let isEarnedType = false;
        if (leaderboardType === 'alltime' || isBotTab) {
          redisKey = V2_ALLTIME_LEADERBOARD_KEY;
        } else if (leaderboardType === 'earned') {
          redisKey = V2_EARNED_LEADERBOARD_KEY;
          isEarnedType = true;
        } else {
          // Default: epoch leaderboard
          const epochNum = queryEpoch ? parseInt(queryEpoch, 10) : gameState.currentEpoch;
          redisKey = V2_EPOCH_LEADERBOARD_KEY(epochNum);
        }

        // Backfill: ensure all flagged bot addresses are in the alltime sorted set.
        // Bots may have been clicking before the alltime set existed (lazy backfill
        // only triggers on stats fetch, and we now block bot POSTs). This reads
        // their V2_TOTAL_CLICKS_KEY and upserts into the sorted set.
        if (isBotTab) {
          const backfillPromises = [];
          for (const botAddr of FLAGGED_BOT_ADDRESSES) {
            backfillPromises.push(
              redis.get(V2_TOTAL_CLICKS_KEY(botAddr)).then(total => {
                const clicks = parseInt(total || '0', 10);
                if (clicks > 0) {
                  return redis.zadd(V2_ALLTIME_LEADERBOARD_KEY, {
                    score: clicks,
                    member: JSON.stringify({ address: botAddr })
                  });
                }
              })
            );
          }
          await Promise.all(backfillPromises);
        }

        // Over-fetch to account for bot filtering — we may need to skip several entries
        // to fill the requested limit after removing bots (or non-bots for the bot tab)
        const fetchLimit = Math.min(limitNum * 3, 300);
        const entries = await redis.zrange(redisKey, 0, fetchLimit - 1, {
          rev: true,
          withScores: true
        });

        const parsed = [];
        for (let i = 0; i < entries.length; i += 2) {
          if (parsed.length >= limitNum) break;

          try {
            const data = typeof entries[i] === 'string' ? JSON.parse(entries[i]) : entries[i];
            const score = parseFloat(entries[i + 1]);
            const addr = data.address?.toLowerCase();

            // Filter: bot tab shows only bots, all other tabs exclude bots
            if (isBotTab && !isFlaggedBot(addr)) continue;
            if (!isBotTab && isFlaggedBot(addr)) continue;

            const entry = {
              rank: parsed.length + 1,
              ...data,
              totalClicks: isEarnedType ? undefined : Math.floor(score),
            };
            if (isEarnedType) {
              // Score is earned in wei (as float due to Redis), convert to string
              entry.totalEarned = BigInt(Math.floor(score)).toString();
            }
            if (isBotTab) {
              entry.isBot = true;
            }
            parsed.push(entry);
          } catch {
            // Skip malformed entries
          }
        }

        const response = {
          success: true,
          leaderboardType: leaderboardType || 'epoch',
          leaderboard: parsed,
          gameState
        };

        // Include epoch-specific data for epoch type
        if (!leaderboardType || leaderboardType === 'epoch') {
          const epochNum = queryEpoch ? parseInt(queryEpoch, 10) : gameState.currentEpoch;
          response.epoch = epochNum;
          response.epochTotalClicks = parseInt(await redis.get(V2_EPOCH_TOTAL_KEY(epochNum)) || '0', 10);
        }

        return res.status(200).json(response);
      }

      // Active users request
      if (activeUsers === 'true') {
        const cutoffTime = Date.now() - (60 * 1000); // 60 seconds ago
        // Count users with heartbeat in last 60 seconds
        const activeCount = await redis.zcount(ACTIVE_USERS_SET, cutoffTime, '+inf');
        // Get global clicks (max of v1 and v2 counters)
        const v1Global = parseInt(await redis.get(GLOBAL_CLICKS_KEY) || '0', 10);
        const v2Global = parseInt(await redis.get(V2_GLOBAL_CLICKS_KEY) || '0', 10);
        const rawGlobalClicks = Math.max(v1Global, v2Global);

        // Subtract flagged bot clicks from the global total
        let botClicks = 0;
        const botTotals = await Promise.all(
          Array.from(FLAGGED_BOT_ADDRESSES).map(addr =>
            redis.get(V2_TOTAL_CLICKS_KEY(addr))
          )
        );
        for (const total of botTotals) {
          botClicks += parseInt(total || '0', 10);
        }
        const globalClicks = Math.max(0, rawGlobalClicks - botClicks);

        // Sum all-time earned from leaderboard, excluding bots
        let globalEarned = '0';
        try {
          const earnedEntries = await redis.zrange(V2_EARNED_LEADERBOARD_KEY, 0, -1, {
            withScores: true
          });
          const botSet = FLAGGED_BOT_ADDRESSES;
          let totalWei = BigInt(0);
          for (let i = 0; i < earnedEntries.length; i += 2) {
            try {
              const raw = earnedEntries[i];
              const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const score = BigInt(Math.floor(earnedEntries[i + 1]));
              if (!botSet.has(data.address?.toLowerCase())) {
                totalWei += score;
              }
            } catch {
              // Skip malformed entry
            }
          }
          globalEarned = totalWei.toString();
        } catch (e) {
          // Non-critical — fall back to '0'
        }

        return res.status(200).json({
          success: true,
          activeHumans: activeCount || 0,
          activeBots: 0, // V2 is human-only
          globalClicks,
          globalEarned,
          _debug: { botClicks, rawGlobalClicks }
        });
      }

      // Sync achievements - retroactively grant any missing achievements
      // based on current total clicks (useful for achievements added after user played)
      if (syncAchievements === 'true') {
        if (!validateAddress(address)) {
          return res.status(400).json({ error: 'Invalid or missing address' });
        }

        const addr = address.toLowerCase();
        const v1Stats = await redis.hgetall(CLICKS_KEY(addr));
        const v1Clicks = parseInt(v1Stats?.totalClicks || '0', 10);
        const v2Clicks = parseInt(await redis.get(V2_TOTAL_CLICKS_KEY(addr)) || '0', 10);
        const registryClicks = await getRegistryClicks(addr);

        // Total is: max of (v1 + v2 Redis) or registry, to avoid double-counting
        const totalClicks = Math.max(v1Clicks + v2Clicks, Number(registryClicks));

        if (totalClicks === 0) {
          return res.status(200).json({
            success: true,
            address: addr,
            totalClicks: 0,
            newAchievements: [],
            message: 'No clicks recorded yet'
          });
        }

        const unlockedAchievements = await redis.smembers(ACHIEVEMENTS_KEY(addr)) || [];
        const newAchievements = [];

        // Check all hidden achievements
        for (const hidden of HIDDEN_ACHIEVEMENTS) {
          if (totalClicks >= hidden.triggerClick && !unlockedAchievements.includes(hidden.id)) {
            await redis.sadd(ACHIEVEMENTS_KEY(addr), hidden.id);
            await redis.sadd(ELIGIBLE_KEY, addr);
            newAchievements.push({ ...hidden, type: 'hidden' });
          }
        }

        // Also check personal milestones
        const unlockedMilestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
        const newMilestones = [];

        for (const milestone of PERSONAL_MILESTONES) {
          if (totalClicks >= milestone.clicks && !unlockedMilestones.includes(milestone.id)) {
            await redis.sadd(MILESTONES_KEY(addr), milestone.id);
            newMilestones.push(milestone);
          }
        }

        // Check global 1/1 milestones - only award if THIS user actually triggered
        const v1Global = parseInt(await redis.get(GLOBAL_CLICKS_KEY) || '0', 10);
        const v2Global = parseInt(await redis.get(V2_GLOBAL_CLICKS_KEY) || '0', 10);
        const globalClicks = Math.max(v1Global, v2Global);
        const newGlobalMilestones = [];

        if (globalClicks > 0) {
          for (const gm of GLOBAL_MILESTONES) {
            if (globalClicks >= gm.globalClick) {
              const existingWinner = await redis.hget(GLOBAL_MILESTONES_KEY, gm.id);
              if (!existingWinner) {
                // Verify this user actually triggered this global click number
                const triggeredBy = await redis.get(GLOBAL_TRIGGER_KEY(gm.globalClick));
                if (triggeredBy?.toLowerCase() === addr) {
                  await redis.hset(GLOBAL_MILESTONES_KEY, { [gm.id]: addr });
                  await redis.sadd(ACHIEVEMENTS_KEY(addr), gm.id);
                  await redis.sadd(ELIGIBLE_KEY, addr);
                  newGlobalMilestones.push({ ...gm, type: 'global' });
                }
              }
            }
          }
        }

        return res.status(200).json({
          success: true,
          address: addr,
          totalClicks,
          globalClicks,
          newMilestones,
          newAchievements,
          newGlobalMilestones,
          message: newAchievements.length > 0 || newMilestones.length > 0 || newGlobalMilestones.length > 0
            ? `Synced ${newMilestones.length} milestones, ${newAchievements.length} achievements, and ${newGlobalMilestones.length} global 1/1s`
            : 'All achievements already synced'
        });
      }

      // Claimable epochs request
      if (claimable === 'true') {
        if (!validateAddress(address)) {
          return res.status(400).json({ error: 'Invalid or missing address' });
        }

        const addr = address.toLowerCase();
        const claimableEpochs = [];

        // Check each epoch up to current
        for (let ep = 1; ep <= gameState.currentEpoch; ep++) {
          const clicks = parseInt(await redis.get(V2_CLICKS_KEY(addr, ep)) || '0', 10);
          if (clicks > 0) {
            const claimedOnChain = await hasClaimedOnChain(addr, ep);
            const signatureIssued = await redis.get(V2_CLAIM_ISSUED_KEY(addr, ep));

            claimableEpochs.push({
              epoch: ep,
              clicks,
              claimedOnChain,
              signatureIssued: !!signatureIssued
            });
          }
        }

        return res.status(200).json({
          success: true,
          address: addr,
          claimableEpochs,
          gameState
        });
      }

      // Player stats request
      if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid or missing address' });
      }

      const addr = address.toLowerCase();

      // Get Redis stats
      const redisTotal = parseInt(await redis.get(V2_TOTAL_CLICKS_KEY(addr)) || '0', 10);
      const currentEpochClicks = parseInt(await redis.get(V2_CLICKS_KEY(addr, gameState.currentEpoch)) || '0', 10);

      // Get on-chain registry stats
      const [registryClicks, registryEarned] = await Promise.all([
        getRegistryClicks(addr),
        getRegistryEarned(addr)
      ]);

      // Total is max of Redis (current season unclaimed) + registry (claimed across all seasons)
      // Note: Once claimed, clicks move from Redis tracking to registry
      const lifetimeClicks = Math.max(redisTotal, Number(registryClicks));

      // Update all-time and earned leaderboards (lazily populated on user stats fetch)
      const leaderboardUpdates = [
        redis.zadd(V2_ALLTIME_LEADERBOARD_KEY, {
          score: lifetimeClicks,
          member: JSON.stringify({ address: addr })
        })
      ];
      if (Number(registryEarned) > 0) {
        leaderboardUpdates.push(
          redis.zadd(V2_EARNED_LEADERBOARD_KEY, {
            score: Number(registryEarned),
            member: JSON.stringify({ address: addr })
          })
        );
      }
      // Fire-and-forget — don't block the response
      Promise.all(leaderboardUpdates).catch(() => {});

      // Get rank in current epoch
      const rank = await redis.zrevrank(
        V2_EPOCH_LEADERBOARD_KEY(gameState.currentEpoch),
        JSON.stringify({ address: addr })
      );

      // Get milestones/achievements (shared with V1)
      const unlockedMilestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
      const unlockedAchievements = await redis.smembers(ACHIEVEMENTS_KEY(addr)) || [];
      const streakData = await redis.hgetall(STREAK_KEY(addr)) || {};

      // Include current difficulty so frontend can sync mining target
      const gameActive = gameState.gameStarted && !gameState.gameEnded;
      const currentDifficulty = gameActive
        ? await adjustDifficultyIfNeeded(redis, gameState)
        : MAX_DIFFICULTY_TARGET;

      const v1Global = parseInt(await redis.get(GLOBAL_CLICKS_KEY) || '0', 10);
      const v2Global = parseInt(await redis.get(V2_GLOBAL_CLICKS_KEY) || '0', 10);
      const globalClicks = Math.max(v1Global, v2Global);

      return res.status(200).json({
        success: true,
        address: addr,
        totalClicks: lifetimeClicks,
        currentEpochClicks,
        seasonClicks: redisTotal,
        lifetimeClicks,
        registryClicks: Number(registryClicks),
        lifetimeEarned: registryEarned.toString(), // In wei, as string to avoid precision loss
        rank: rank !== null ? rank + 1 : null,
        globalClicks,
        milestones: unlockedMilestones,
        achievements: unlockedAchievements,
        streak: {
          current: parseInt(streakData.currentStreak || '0', 10),
          longest: parseInt(streakData.longestStreak || '0', 10),
          totalDays: parseInt(streakData.totalDays || '0', 10)
        },
        difficultyTarget: '0x' + currentDifficulty.toString(16),
        gameState
      });
    }

    // =========================================================================
    // POST REQUESTS
    // =========================================================================
    if (req.method === 'POST') {
      const body = req.body || {};
      const { address, action, epoch: requestedEpoch, turnstileToken, nonces, heartbeat } = body;

      // -----------------------------------------------------------------------
      // ADMIN ACTIONS (do not require a player address)
      // -----------------------------------------------------------------------
      if (action === 'admin_reset' || action === 'reset_difficulty' || action === 'set_difficulty') {
        const adminKey = req.headers['x-admin-key'];
        const expectedKey = process.env.CLICKSTR_ADMIN_SECRET;
        if (!adminKey || adminKey !== expectedKey) {
          return res.status(403).json({ error: 'Unauthorized' });
        }

        if (action === 'admin_reset') {
          if (address && !validateAddress(address)) {
            return res.status(400).json({ error: 'Invalid address' });
          }

          // If no address provided, reset ALL V2 + shared data
          if (!address) {
            const patterns = [
              'clickstr:v2:*',
              'clickstr:milestones:*',
              'clickstr:achievements:*',
              'clickstr:human-session:*',
              'clickstr:global-trigger:*',
              'clickstr:clicks:*',
              'clickstr:streak:*',
              'clickstr:time-clicks:*',
            ];

            const keysToDelete = new Set([
              ELIGIBLE_KEY,
              GLOBAL_MILESTONES_KEY,
              GLOBAL_CLICKS_KEY,
              V2_GLOBAL_CLICKS_KEY,
              CLICK_LOG_KEY,
              ACTIVE_USERS_SET,
              V2_ALLTIME_LEADERBOARD_KEY,
              V2_EARNED_LEADERBOARD_KEY,
              'clickstr:leaderboard',
              'clickstr:onchain-leaderboard',
            ]);

            for (const pattern of patterns) {
              let cursor = '0';
              do {
                const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 200 });
                cursor = nextCursor;
                for (const key of keys) {
                  keysToDelete.add(key);
                }
              } while (cursor !== '0');
            }

            let deleted = 0;
            for (const key of keysToDelete) {
              const result = await redis.del(key);
              if (result) deleted++;
            }

            return res.status(200).json({
              success: true,
              message: 'Reset all V2 + shared data (global + per-user)',
              keysDeleted: deleted
            });
          }

          // Otherwise reset a single address
          const addr = address.toLowerCase();

          // Delete all V2 keys for this user
          const keysToDelete = [];
          for (let ep = 1; ep <= 100; ep++) {
            keysToDelete.push(V2_CLICKS_KEY(addr, ep));
            keysToDelete.push(V2_USED_NONCES_KEY(addr, ep));
            keysToDelete.push(V2_CLAIM_ISSUED_KEY(addr, ep));
            keysToDelete.push(V2_CLAIM_CHALLENGE_KEY(addr, ep));
          }
          keysToDelete.push(V2_TOTAL_CLICKS_KEY(addr));
          keysToDelete.push(HUMAN_SESSION_KEY(addr));
          keysToDelete.push(MILESTONES_KEY(addr));
          keysToDelete.push(ACHIEVEMENTS_KEY(addr));
          keysToDelete.push(STREAK_KEY(addr));
          keysToDelete.push(CLICKS_KEY(addr));

          // Delete all keys
          for (const key of keysToDelete) {
            await redis.del(key);
          }

          // Remove from all epoch leaderboards
          for (let ep = 1; ep <= 100; ep++) {
            await redis.zrem(V2_EPOCH_LEADERBOARD_KEY(ep), JSON.stringify({ address: addr }));
          }

          await redis.srem(ELIGIBLE_KEY, addr);
          await redis.zrem(ACTIVE_USERS_SET, addr);
          await redis.zrem(V2_ALLTIME_LEADERBOARD_KEY, JSON.stringify({ address: addr }));
          await redis.zrem(V2_EARNED_LEADERBOARD_KEY, JSON.stringify({ address: addr }));

          return res.status(200).json({ success: true, message: `Reset all V2 data for ${addr}` });
        }

        if (action === 'reset_difficulty') {
          const oldDifficulty = await getCurrentDifficulty(redis);
          await redis.del(V2_DIFFICULTY_KEY);
          await redis.del(V2_DIFFICULTY_EPOCH_KEY);
          await redis.del(V2_DIFFICULTY_SEASON_KEY);

          return res.status(200).json({
            success: true,
            message: 'Difficulty reset to default',
            oldDifficulty: '0x' + oldDifficulty.toString(16),
            newDifficulty: '0x' + DEFAULT_DIFFICULTY_TARGET.toString(16),
          });
        }

        if (action === 'set_difficulty') {
          const { difficulty: newDifficultyHex } = body;
          if (!newDifficultyHex) {
            return res.status(400).json({ error: 'Missing difficulty value. Pass hex string e.g. "0x00ff..."' });
          }

          let newDifficulty;
          try {
            newDifficulty = BigInt(newDifficultyHex);
          } catch {
            return res.status(400).json({ error: 'Invalid difficulty value. Must be hex or decimal BigInt string.' });
          }

          if (newDifficulty < MIN_DIFFICULTY_TARGET) {
            return res.status(400).json({ error: `Difficulty too low. Minimum: ${MIN_DIFFICULTY_TARGET}` });
          }
          if (newDifficulty > MAX_DIFFICULTY_TARGET) {
            return res.status(400).json({ error: `Difficulty too high. Maximum: 0x${MAX_DIFFICULTY_TARGET.toString(16)}` });
          }

          const gameState = await getGameState();
          const oldDifficulty = await getCurrentDifficulty(redis);
          await redis.set(V2_DIFFICULTY_KEY, newDifficulty.toString());
          // Reset epoch tracking so adjustments start fresh from here
          await redis.set(V2_DIFFICULTY_EPOCH_KEY, gameState.currentEpoch.toString());

          return res.status(200).json({
            success: true,
            message: 'Difficulty updated',
            oldDifficulty: '0x' + oldDifficulty.toString(16),
            newDifficulty: '0x' + newDifficulty.toString(16),
            epochLockedAt: gameState.currentEpoch,
          });
        }
      }

      if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid or missing address' });
      }

      const addr = address.toLowerCase();

      // -----------------------------------------------------------------------
      // BOT BLOCKING - Reject all actions from flagged bot addresses
      // -----------------------------------------------------------------------
      if (isFlaggedBot(addr)) {
        return res.status(403).json({ error: 'Address is flagged' });
      }

      const gameState = await getGameState();
      const clientIp = getClientIp(req);
      const ipHash = hashIp(clientIp);

      // -----------------------------------------------------------------------
      // HEARTBEAT - Track active users
      // -----------------------------------------------------------------------
      if (heartbeat === true) {
        const now = Date.now();
        await redis.zadd(ACTIVE_USERS_SET, { score: now, member: addr });
        return res.status(200).json({ success: true });
      }

      // -----------------------------------------------------------------------
      // CLAIM ACTION - Generate signature for on-chain claim
      // -----------------------------------------------------------------------
      if (action === 'claim') {
        const epoch = parseInt(requestedEpoch, 10);
        if (!epoch || epoch < 1 || epoch > gameState.totalEpochs) {
          return res.status(400).json({ error: 'Invalid epoch' });
        }

        // Check if epoch is claimable (started)
        if (epoch > gameState.currentEpoch) {
          return res.status(400).json({ error: 'Epoch not started yet' });
        }

        // Get user's clicks for this epoch
        const clicks = parseInt(await redis.get(V2_CLICKS_KEY(addr, epoch)) || '0', 10);
        if (clicks === 0) {
          return res.status(400).json({ error: 'No clicks for this epoch' });
        }

        // Check how many clicks already claimed on-chain (for incremental claims)
        const alreadyClaimedClicks = await getClaimedClicksOnChain(addr, epoch);
        if (clicks <= alreadyClaimedClicks) {
          return res.status(400).json({
            error: 'No new clicks to claim',
            currentClicks: clicks,
            alreadyClaimed: alreadyClaimedClicks
          });
        }

        // Require a valid human session for claim attestations
        const now = Date.now();
        const humanSession = await redis.hgetall(HUMAN_SESSION_KEY(addr));
        const sessionExpiry = parseInt(humanSession?.expiresAt || '0', 10);
        const sessionClicks = parseInt(humanSession?.clicksSinceVerify || '0', 10);
        const sessionIpHash = humanSession?.ipHash || '';
        const isSessionValid = sessionExpiry > now;
        const ipMismatch = ipHash && sessionIpHash && ipHash !== sessionIpHash;
        const missingIpBinding = ipHash && !sessionIpHash;
        const needsReverification = ipMismatch || missingIpBinding;

        if (!isSessionValid || needsReverification) {
          if (process.env.TURNSTILE_SECRET_KEY) {
            if (!turnstileToken) {
              const reason = !isSessionValid ? 'session_expired' : 'ip_mismatch';
              return res.status(403).json({
                error: 'Human verification required',
                requiresVerification: true,
                reason
              });
            }

            const verification = await verifyTurnstile(turnstileToken);
            if (!verification.success) {
              return res.status(403).json({
                error: 'Verification failed',
                requiresVerification: true
              });
            }

            await redis.hset(HUMAN_SESSION_KEY(addr), {
              verifiedAt: now,
              expiresAt: now + HUMAN_SESSION_DURATION,
              clicksSinceVerify: 0,
              ipHash
            });
          }
        }

        const challengeKey = V2_CLAIM_CHALLENGE_KEY(addr, epoch);
        const ensureChallenge = async (reason) => {
          let challengeData = null;
          const existing = await redis.get(challengeKey);
          if (existing) {
            try {
              // Upstash auto-deserializes JSON
              challengeData = typeof existing === 'string' ? JSON.parse(existing) : existing;
            } catch {
              await redis.del(challengeKey);
            }
          }

          if (!challengeData) {
            const nonce = randomBytes(16).toString('hex');
            const issuedAt = new Date().toISOString();
            const expiresAt = Date.now() + (CLAIM_CHALLENGE_TTL_SECONDS * 1000);
            const message = [
              'Clickstr V2 Claim Authentication',
              `Address: ${addr}`,
              `Epoch: ${epoch}`,
              `Chain ID: ${CHAIN_ID}`,
              `Nonce: ${nonce}`,
              `Issued At: ${issuedAt}`
            ].join('\n');

            challengeData = { message, nonce, issuedAt, expiresAt };
            await redis.set(
              challengeKey,
              JSON.stringify(challengeData),
              { ex: CLAIM_CHALLENGE_TTL_SECONDS }
            );
          }

          return res.status(401).json({
            error: reason,
            requiresSignature: true,
            challenge: challengeData.message,
            expiresAt: challengeData.expiresAt
          });
        };

        const walletSignature = body.walletSignature;
        const providedChallenge = body.challenge; // Frontend sends the challenge back

        if (!walletSignature) {
          return await ensureChallenge('Wallet signature required');
        }

        // Try to get challenge from Redis first, fall back to provided challenge
        let challengeMessage = null;
        const existingChallenge = await redis.get(challengeKey);

        if (existingChallenge) {
          try {
            // Upstash auto-deserializes JSON, so existingChallenge may already be an object
            const challengePayload = typeof existingChallenge === 'string'
              ? JSON.parse(existingChallenge)
              : existingChallenge;
            challengeMessage = challengePayload.message;
          } catch {
            await redis.del(challengeKey);
          }
        }

        // If Redis challenge expired/missing but frontend provided the challenge, use it
        // This handles race conditions where the TTL expires between requests
        if (!challengeMessage && providedChallenge) {
          // Validate the provided challenge format to prevent forgery
          const expectedPrefix = `Clickstr V2 Claim Authentication\nAddress: ${addr}\nEpoch: ${epoch}\nChain ID: ${CHAIN_ID}`;
          if (providedChallenge.startsWith(expectedPrefix)) {
            challengeMessage = providedChallenge;
          }
        }

        if (!challengeMessage) {
          return await ensureChallenge('Signature expired, please sign again');
        }

        try {
          const recovered = await recoverMessageAddress({
            message: challengeMessage,
            signature: walletSignature
          });
          if (recovered.toLowerCase() !== addr) {
            return await ensureChallenge('Invalid wallet signature');
          }
        } catch (sigError) {
          console.error('Signature recovery error:', sigError);
          return await ensureChallenge('Invalid wallet signature');
        }

        // Clear the challenge from Redis
        await redis.del(challengeKey);

        // Check if we already issued a signature for this click count
        // For incremental claims, we need to issue a NEW signature if clicks increased
        const existingSignature = await redis.get(V2_CLAIM_ISSUED_KEY(addr, epoch));
        if (existingSignature) {
          const parsed = typeof existingSignature === 'string' ? JSON.parse(existingSignature) : existingSignature;

          // If user has MORE clicks now, we need a new signature
          // If same or fewer clicks, return cached signature
          if (clicks <= parsed.clickCount) {
            return res.status(200).json({
              success: true,
              signature: parsed.signature,
              epoch,
              clickCount: parsed.clickCount,
              seasonNumber: gameState.seasonNumber,
              contractAddress: GAME_CONTRACT_ADDRESS,
              chainId: CHAIN_ID,
              note: 'Returning previously issued signature (no new clicks)'
            });
          }
          // User has more clicks - fall through to generate new signature
          console.log(`[V2 Claim] Incremental claim: ${parsed.clickCount} -> ${clicks} clicks for ${addr} epoch ${epoch}`);
        }

        // Generate signature (new or updated for incremental claim)
        let signature;
        try {
          signature = await signClaimAttestation(
            addr,
            epoch,
            clicks,
            gameState.seasonNumber
          );
        } catch (signError) {
          console.error('Signature generation failed:', signError);
          return res.status(500).json({
            error: 'Signature generation failed',
            message: signError.message,
            details: {
              addr,
              epoch,
              clicks,
              seasonNumber: gameState.seasonNumber,
              hasPrivateKey: !!process.env.ATTESTATION_SIGNER_PRIVATE_KEY,
              gameContractAddress: GAME_CONTRACT_ADDRESS,
              chainId: CHAIN_ID
            }
          });
        }

        // Store issued signature
        const claimIssuedAt = Date.now();
        await redis.set(
          V2_CLAIM_ISSUED_KEY(addr, epoch),
          JSON.stringify({ signature, clickCount: clicks, issuedAt: claimIssuedAt }),
          { ex: 86400 * 30 } // 30 day expiry
        );

        // Track attested clicks for difficulty adjustment.
        // For incremental claims, only count the NEW clicks (delta), not the full total.
        const previouslyAttested = existingSignature
          ? (typeof existingSignature === 'string' ? JSON.parse(existingSignature) : existingSignature).clickCount || 0
          : 0;
        const newAttestedClicks = clicks - previouslyAttested;
        if (newAttestedClicks > 0) {
          await redis.incrby(V2_EPOCH_ATTESTED_KEY(epoch), newAttestedClicks);
        }

        // Log claim event for dashboard history
        const claimEvent = JSON.stringify({
          ts: claimIssuedAt,
          address: addr,
          epoch,
          clicks,
          newAttested: newAttestedClicks,
          season: gameState.seasonNumber,
          incremental: !!existingSignature,
        });
        await redis.zadd(V2_CLAIM_EVENTS_KEY, { score: claimIssuedAt, member: claimEvent });

        return res.status(200).json({
          success: true,
          signature,
          epoch,
          clickCount: clicks,
          seasonNumber: gameState.seasonNumber,
          contractAddress: GAME_CONTRACT_ADDRESS,
          chainId: CHAIN_ID,
          claimData: {
            functionName: 'claimReward',
            args: [epoch, clicks, signature]
          }
        });
      }

      // -----------------------------------------------------------------------
      // CLICK SUBMISSION - Validate and record clicks
      // -----------------------------------------------------------------------
      if (!Array.isArray(nonces) || nonces.length === 0) {
        return res.status(400).json({ error: 'No nonces provided' });
      }

      if (nonces.length > 3000) {
        return res.status(400).json({ error: 'Too many nonces (max 3000)' });
      }

      // Determine if game is active and which epoch to use
      const gameActive = gameState.gameStarted && !gameState.gameEnded;
      // When game is active, use current epoch; when inactive, use epoch 0 for PoW/dedup
      const epoch = gameActive ? gameState.currentEpoch : 0;
      const now = Date.now();

      // Get current difficulty (may adjust if epoch just changed)
      const currentDifficulty = gameActive
        ? await adjustDifficultyIfNeeded(redis, gameState)
        : MAX_DIFFICULTY_TARGET; // Between seasons: easiest difficulty

      // -----------------------------------------------------------------------
      // HUMAN VERIFICATION (Turnstile)
      // -----------------------------------------------------------------------
      const humanSession = await redis.hgetall(HUMAN_SESSION_KEY(addr));
      const sessionExpiry = parseInt(humanSession?.expiresAt || '0', 10);
      const sessionClicks = parseInt(humanSession?.clicksSinceVerify || '0', 10);
      const sessionIpHash = humanSession?.ipHash || '';
      const isSessionValid = sessionExpiry > now;
      const ipMismatch = ipHash && sessionIpHash && ipHash !== sessionIpHash;
      const missingIpBinding = ipHash && !sessionIpHash;
      const needsReverification = ipMismatch || missingIpBinding;

      if (!isSessionValid || needsReverification) {
        if (process.env.TURNSTILE_SECRET_KEY) {
          if (!turnstileToken) {
            const reason = !isSessionValid ? 'session_expired' : 'ip_mismatch';
            return res.status(403).json({
              error: 'Human verification required',
              requiresVerification: true,
              reason
            });
          }

          const verification = await verifyTurnstile(turnstileToken);
          if (!verification.success) {
            return res.status(403).json({
              error: 'Verification failed',
              requiresVerification: true
            });
          }

          // Renew session
          await redis.hset(HUMAN_SESSION_KEY(addr), {
            verifiedAt: now,
            expiresAt: now + HUMAN_SESSION_DURATION,
            clicksSinceVerify: 0,
            ipHash
          });
        }
      }

      // -----------------------------------------------------------------------
      // NONCE VERIFICATION & DEDUPLICATION
      // -----------------------------------------------------------------------
      const usedNoncesKey = V2_USED_NONCES_KEY(addr, epoch);
      let validCount = 0;
      const validNonces = [];

      for (const nonceStr of nonces) {
        // Verify PoW against current difficulty
        if (!verifyNonce(addr, nonceStr, epoch, currentDifficulty)) {
          continue;
        }

        // Check if already used (deduplication)
        const alreadyUsed = await redis.sismember(usedNoncesKey, nonceStr);
        if (alreadyUsed) {
          continue;
        }

        validNonces.push(nonceStr);
        validCount++;
      }

      if (validCount === 0) {
        return res.status(400).json({
          error: 'No valid nonces',
          message: 'All nonces were invalid or already used'
        });
      }

      // -----------------------------------------------------------------------
      // RATE LIMITING — cap valid nonces per address per sliding window
      // Uses a simple Redis counter with TTL. If the window hasn't started yet
      // the key won't exist; we create it and set the TTL on first use.
      // -----------------------------------------------------------------------
      const rateLimitKey = V2_RATE_LIMIT_KEY(addr);
      const currentWindowCount = parseInt(await redis.get(rateLimitKey) || '0', 10);

      if (currentWindowCount >= RATE_LIMIT_MAX_NONCES) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          message: `Max ${RATE_LIMIT_MAX_NONCES} clicks per ${RATE_LIMIT_WINDOW_SECONDS}s window`,
          retryAfterSeconds: await redis.ttl(rateLimitKey),
        });
      }

      // Clamp valid nonces to remaining budget in this window
      const remaining = RATE_LIMIT_MAX_NONCES - currentWindowCount;
      if (validCount > remaining) {
        // Trim to what's allowed — still accept partial batch
        validNonces.length = remaining;
        validCount = remaining;
      }

      // Increment the rate limit counter (set TTL on first use)
      if (currentWindowCount === 0) {
        await redis.set(rateLimitKey, validCount, { ex: RATE_LIMIT_WINDOW_SECONDS });
      } else {
        await redis.incrby(rateLimitKey, validCount);
      }

      // Mark nonces as used
      if (validNonces.length > 0) {
        await redis.sadd(usedNoncesKey, ...validNonces);
        // Set TTL on used nonces (epoch duration + buffer)
        await redis.expire(usedNoncesKey, 86400 * 7);
      }

      // -----------------------------------------------------------------------
      // UPDATE CLICK COUNTS
      // -----------------------------------------------------------------------
      const previousTotal = parseInt(await redis.get(V2_TOTAL_CLICKS_KEY(addr)) || '0', 10);
      const newTotal = previousTotal + validCount;

      const previousGlobalV1 = parseInt(await redis.get(GLOBAL_CLICKS_KEY) || '0', 10);
      const previousGlobalV2 = parseInt(await redis.get(V2_GLOBAL_CLICKS_KEY) || '0', 10);
      const previousGlobal = Math.max(previousGlobalV1, previousGlobalV2);
      const newGlobal = previousGlobal + validCount;

      // Always update lifetime and global counts
      const updatePromises = [
        redis.set(V2_TOTAL_CLICKS_KEY(addr), newTotal),
        redis.set(V2_GLOBAL_CLICKS_KEY, newGlobal),
        redis.set(GLOBAL_CLICKS_KEY, newGlobal),
        redis.hincrby(HUMAN_SESSION_KEY(addr), 'clicksSinceVerify', validCount),
        // Update all-time clicks leaderboard
        redis.zadd(V2_ALLTIME_LEADERBOARD_KEY, {
          score: newTotal,
          member: JSON.stringify({ address: addr })
        })
      ];

      // Only update epoch-specific counts when game is active
      let newEpochClicks = 0;
      if (gameActive) {
        const previousEpochClicks = parseInt(await redis.get(V2_CLICKS_KEY(addr, epoch)) || '0', 10);
        newEpochClicks = previousEpochClicks + validCount;

        updatePromises.push(
          redis.set(V2_CLICKS_KEY(addr, epoch), newEpochClicks),
          redis.incrby(V2_EPOCH_TOTAL_KEY(epoch), validCount),
          redis.zadd(V2_EPOCH_LEADERBOARD_KEY(epoch), {
            score: newEpochClicks,
            member: JSON.stringify({ address: addr })
          })
        );
      }

      await Promise.all(updatePromises);

      // Track click velocity for dashboard
      trackClickVelocity(redis, validCount).catch(() => {});

      // Log for retroactive attribution
      await redis.rpush(CLICK_LOG_KEY, JSON.stringify({
        a: addr,
        c: validCount,
        b: previousGlobal,
        f: newGlobal,
        t: now,
        v: 2 // Version marker
      }));

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

      // -----------------------------------------------------------------------
      // CHECK ACHIEVEMENTS (using combined total)
      // -----------------------------------------------------------------------
      const newMilestones = [];
      const newAchievements = [];

      // Get registry clicks for true lifetime total
      const registryClicks = await getRegistryClicks(addr);
      const v1Stats = await redis.hgetall(CLICKS_KEY(addr));
      const v1Clicks = parseInt(v1Stats?.totalClicks || '0', 10);
      const lifetimeTotal = Math.max(v1Clicks + newTotal, Number(registryClicks));

      // Check personal milestones
      const unlockedMilestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
      for (const milestone of PERSONAL_MILESTONES) {
        if (lifetimeTotal >= milestone.clicks && !unlockedMilestones.includes(milestone.id)) {
          await redis.sadd(MILESTONES_KEY(addr), milestone.id);
          await redis.sadd(ELIGIBLE_KEY, addr);
          newMilestones.push(milestone);
        }
      }

      // Check global milestones
      for (const gm of GLOBAL_MILESTONES) {
        if (previousGlobal < gm.globalClick && newGlobal >= gm.globalClick) {
          const triggerKey = GLOBAL_TRIGGER_KEY(gm.globalClick);
          const existingTrigger = await redis.get(triggerKey);
          if (!existingTrigger) {
            await redis.set(triggerKey, addr);
          }
          const existingWinner = await redis.hget(GLOBAL_MILESTONES_KEY, gm.id);
          if (!existingWinner) {
            await redis.hset(GLOBAL_MILESTONES_KEY, { [gm.id]: addr });
            await redis.sadd(ACHIEVEMENTS_KEY(addr), gm.id);
            await redis.sadd(ELIGIBLE_KEY, addr);
            newAchievements.push({ ...gm, type: 'global' });
          }
        }
      }

      // Check hidden achievements
      const unlockedAchievements = await redis.smembers(ACHIEVEMENTS_KEY(addr)) || [];
      for (const hidden of HIDDEN_ACHIEVEMENTS) {
        if (lifetimeTotal >= hidden.triggerClick && !unlockedAchievements.includes(hidden.id)) {
          await redis.sadd(ACHIEVEMENTS_KEY(addr), hidden.id);
          await redis.sadd(ELIGIBLE_KEY, addr);
          newAchievements.push({ ...hidden, type: 'hidden' });
        }
      }

      // Check streak achievements
      for (const streak of STREAK_ACHIEVEMENTS) {
        if (currentStreak >= streak.days && !unlockedAchievements.includes(streak.id)) {
          await redis.sadd(ACHIEVEMENTS_KEY(addr), streak.id);
          await redis.sadd(ELIGIBLE_KEY, addr);
          newAchievements.push({ ...streak, type: 'streak' });
        }
      }

      // Check epoch achievements (only when game is active)
      if (gameActive && epoch) {
        for (const ea of EPOCH_ACHIEVEMENTS) {
          if (epoch === ea.epoch && !unlockedAchievements.includes(ea.id)) {
            await redis.sadd(ACHIEVEMENTS_KEY(addr), ea.id);
            await redis.sadd(ELIGIBLE_KEY, addr);
            newAchievements.push({ ...ea, type: 'epoch' });
          }
        }
      }

      // Get rank (only meaningful when game is active)
      let rank = null;
      if (gameActive) {
        const rankResult = await redis.zrevrank(
          V2_EPOCH_LEADERBOARD_KEY(epoch),
          JSON.stringify({ address: addr })
        );
        rank = rankResult !== null ? rankResult + 1 : null;
      }

      return res.status(200).json({
        success: true,
        address: addr,
        validClicks: validCount,
        invalidClicks: nonces.length - validCount,
        epochClicks: gameActive ? newEpochClicks : null,
        seasonClicks: newTotal,
        lifetimeClicks: lifetimeTotal,
        globalClicks: newGlobal,
        epoch: gameActive ? epoch : null,
        difficultyTarget: '0x' + currentDifficulty.toString(16),
        rank,
        gameActive,
        streak: { current: currentStreak, longest: longestStreak },
        newMilestones: newMilestones.length > 0 ? newMilestones : null,
        newAchievements: newAchievements.length > 0 ? newAchievements : null,
        nextMilestone: PERSONAL_MILESTONES.find(m => m.clicks > lifetimeTotal) || null
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Clickstr V2 API error:', error);
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}
