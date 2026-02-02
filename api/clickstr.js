import { Redis } from '@upstash/redis';
import { keccak256, encodePacked } from 'viem';

/**
 * Stupid Clicker - Frontend Click Tracking API
 *
 * Tracks FRONTEND clicks only (not on-chain submissions).
 * This enables Cookie Clicker-style rewards for human players using the UI.
 *
 * Redis keys:
 *   - clickstr:clicks:{address} - Hash with cumulative stats per address
 *   - clickstr:leaderboard - Sorted set for rankings by total frontend clicks
 *   - clickstr:milestones:{address} - Set of unlocked milestone IDs
 *   - clickstr:heartbeat:{address} - Active frontend session (60s TTL)
 *
 * Endpoints:
 *   GET  /api/clickstr?address=0x...     - Get player stats
 *   POST /api/clickstr                    - Record clicks from frontend
 *   POST /api/clickstr (heartbeat=true)  - Send heartbeat for active user tracking
 *   GET  /api/clickstr?leaderboard=true  - Get leaderboard
 *   GET  /api/clickstr?activeUsers=true  - Get count of active humans clicking
 *   GET  /api/clickstr?eligible=true&address=0x... - Check NFT eligibility
 */

// =============================================================================
// MILESTONE & ACHIEVEMENT DEFINITIONS
// =============================================================================

// Personal Milestones - unlock at these individual click counts
// tier = NFT token ID in ClickstrNFT contract (1-12 for personal milestones)
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
// tier = NFT token ID (200+ for global 1/1 milestones)
// Must match claim-signature.js GLOBAL_MILESTONES
const GLOBAL_MILESTONES = [
  // Main milestones (200-213)
  { id: 'global-1', tier: 200, globalClick: 1, name: 'The First Click', description: 'The very first click ever' },
  { id: 'global-10', tier: 201, globalClick: 10, name: 'The Tenth', description: 'The 10th click' },
  { id: 'global-100', tier: 202, globalClick: 100, name: 'Century', description: 'The 100th click' },
  { id: 'global-1000', tier: 206, globalClick: 1000, name: 'Thousandaire', description: 'The 1,000th click' },
  { id: 'global-10000', tier: 208, globalClick: 10000, name: 'Ten Grand', description: 'The 10,000th click' },
  { id: 'global-100000', tier: 209, globalClick: 100000, name: 'The Hundred Thousandth', description: 'The 100,000th click' },
  { id: 'global-1000000', tier: 210, globalClick: 1000000, name: 'The Millionth Click', description: 'The 1,000,000th click' },
  { id: 'global-10000000', tier: 211, globalClick: 10000000, name: 'Ten Million', description: 'The 10,000,000th click' },
  { id: 'global-100000000', tier: 213, globalClick: 100000000, name: 'Hundred Million', description: 'The 100,000,000th click' },
  { id: 'global-1000000000', tier: 209, globalClick: 1000000000, name: 'Billionaire', description: 'The 1,000,000,000th click' },

  // Hidden global meme numbers (220-229)
  { id: 'global-42', tier: 229, globalClick: 42, name: 'Meaning of Everything', description: 'The answer to life, the universe, and everything' },
  { id: 'global-69', tier: 220, globalClick: 69, name: 'Nice', description: 'Nice.' },
  { id: 'global-420', tier: 221, globalClick: 420, name: 'Blaze It', description: '420 blaze it' },
  { id: 'global-666', tier: 222, globalClick: 666, name: "Devil's Click", description: 'The number of the beast' },
  { id: 'global-777', tier: 223, globalClick: 777, name: 'Lucky Sevens', description: 'Jackpot!' },
  { id: 'global-1337', tier: 224, globalClick: 1337, name: 'Elite', description: 'L33T H4X0R' },
  { id: 'global-42069', tier: 225, globalClick: 42069, name: 'The Perfect Number', description: 'The ultimate meme number' },
  { id: 'global-69420', tier: 226, globalClick: 69420, name: 'Ultra Nice', description: 'Peak absurdity' },
  { id: 'global-8008135', tier: 227, globalClick: 8008135, name: 'Calculator Masterpiece', description: 'BOOBIES on a calculator' },
  { id: 'global-8675309', tier: 228, globalClick: 8675309, name: 'Jenny', description: 'Jenny I got your number' },

  // Repeated digits - ones (240-247)
  { id: 'global-111', tier: 240, globalClick: 111, name: 'Triple Ones', description: '111' },
  { id: 'global-1111', tier: 241, globalClick: 1111, name: 'Quad Ones', description: '1111' },
  { id: 'global-11111', tier: 242, globalClick: 11111, name: 'Make a Wish', description: '11:11' },
  { id: 'global-111111', tier: 243, globalClick: 111111, name: 'Six Ones', description: '111111' },

  // Repeated digits - sevens (250-255)
  { id: 'global-7777', tier: 250, globalClick: 7777, name: 'Jackpot', description: '7777' },
  { id: 'global-77777', tier: 251, globalClick: 77777, name: 'Mega Jackpot', description: '77777' },
  { id: 'global-777777', tier: 252, globalClick: 777777, name: 'Slot Machine God', description: '777777' },

  // Repeated digits - eights (260-266)
  { id: 'global-888', tier: 260, globalClick: 888, name: 'Prosperity', description: 'Lucky in Chinese' },
  { id: 'global-8888', tier: 261, globalClick: 8888, name: 'Very Lucky', description: '8888' },
  { id: 'global-888888', tier: 263, globalClick: 888888, name: 'Fortune', description: '888888' },

  // Repeated digits - nines (270-276)
  { id: 'global-999', tier: 270, globalClick: 999, name: 'So Close', description: '999' },
  { id: 'global-9999', tier: 271, globalClick: 9999, name: 'Edge Lord', description: '9999' },
  { id: 'global-999999', tier: 273, globalClick: 999999, name: 'One Away', description: '999999' },

  // Palindromes (280-290)
  { id: 'global-101', tier: 280, globalClick: 101, name: 'Binary Palindrome', description: '101' },
  { id: 'global-1001', tier: 281, globalClick: 1001, name: 'Bookends', description: '1001' },
  { id: 'global-10001', tier: 282, globalClick: 10001, name: 'Symmetric', description: '10001' },
  { id: 'global-12321', tier: 283, globalClick: 12321, name: 'Counting Palindrome', description: '12321' },
  { id: 'global-123321', tier: 284, globalClick: 123321, name: 'Mirror Mirror', description: '123321' },
  { id: 'global-1234321', tier: 285, globalClick: 1234321, name: 'The Mountain', description: '1234321' },

  // Mathematical (300-312)
  { id: 'global-137', tier: 300, globalClick: 137, name: 'Fine Structure', description: 'Physics constant' },
  { id: 'global-314', tier: 301, globalClick: 314, name: 'Pi Day', description: '3.14' },
  { id: 'global-1618', tier: 302, globalClick: 1618, name: 'Golden', description: 'Golden ratio' },
  { id: 'global-2718', tier: 303, globalClick: 2718, name: "Euler's Click", description: "Euler's number e" },
  { id: 'global-3141', tier: 304, globalClick: 3141, name: 'More Pi', description: '3.141' },
  { id: 'global-31415', tier: 305, globalClick: 31415, name: 'Pi Squared', description: '3.1415' },
  { id: 'global-314159', tier: 306, globalClick: 314159, name: 'Full Pi', description: '3.14159' },

  // Powers of 2 (320-330)
  { id: 'global-256', tier: 320, globalClick: 256, name: 'Byte', description: '2^8' },
  { id: 'global-512', tier: 321, globalClick: 512, name: 'Half K', description: '2^9' },
  { id: 'global-1024', tier: 322, globalClick: 1024, name: 'Kilobyte', description: '2^10' },
  { id: 'global-2048', tier: 323, globalClick: 2048, name: 'The Game', description: '2^11' },
  { id: 'global-4096', tier: 324, globalClick: 4096, name: '2^12', description: '2^12' },
  { id: 'global-8192', tier: 325, globalClick: 8192, name: '2^13', description: '2^13' },
  { id: 'global-16384', tier: 326, globalClick: 16384, name: '2^14', description: '2^14' },
  { id: 'global-32768', tier: 327, globalClick: 32768, name: '2^15', description: '2^15' },
  { id: 'global-65536', tier: 328, globalClick: 65536, name: '2^16', description: '2^16' },

  // Cultural (340-352)
  { id: 'global-404', tier: 340, globalClick: 404, name: 'Not Found', description: 'HTTP 404' },
  { id: 'global-500', tier: 341, globalClick: 500, name: 'Server Error', description: 'HTTP 500' },
  { id: 'global-747', tier: 342, globalClick: 747, name: 'Jumbo', description: 'Boeing 747' },
  { id: 'global-911', tier: 343, globalClick: 911, name: 'Emergency', description: 'Emergency services' },
  { id: 'global-1984', tier: 344, globalClick: 1984, name: 'Orwellian', description: 'Big Brother' },
  { id: 'global-2001', tier: 345, globalClick: 2001, name: 'Space Odyssey', description: 'Kubrick film' },
  { id: 'global-2012', tier: 346, globalClick: 2012, name: 'End Times', description: 'Mayan apocalypse' },
  { id: 'global-3000', tier: 347, globalClick: 3000, name: 'Love You 3000', description: 'MCU reference' },
  { id: 'global-525600', tier: 349, globalClick: 525600, name: 'Seasons of Love', description: 'Minutes in a year' },
];

// Hidden Achievements - triggered at specific personal click numbers (don't announce!)
// tier = NFT token ID (500+ for hidden achievements)
// Must match claim-signature.js HIDDEN_MILESTONES
const HIDDEN_ACHIEVEMENTS = [
  // Meme numbers (500-511)
  { id: 'nice', tier: 500, triggerClick: 69, name: 'Nice', description: 'Nice.' },
  { id: 'blaze-it', tier: 501, triggerClick: 420, name: 'Blaze It', description: '420 blaze it' },
  { id: 'devils-click', tier: 502, triggerClick: 666, name: "Devil's Click", description: 'The number of the beast' },
  { id: 'lucky-7s', tier: 503, triggerClick: 777, name: 'Lucky 7s', description: 'Jackpot!' },
  { id: 'elite', tier: 504, triggerClick: 1337, name: 'Elite', description: 'L33T H4X0R' },
  { id: 'calculator-word', tier: 505, triggerClick: 8008, name: 'Calculator Word', description: 'BOOB' },
  { id: 'perfect-number', tier: 506, triggerClick: 42069, name: 'The Perfect Number', description: 'The ultimate meme' },
  { id: 'ultra-nice', tier: 507, triggerClick: 69420, name: 'Ultra Nice', description: 'Peak absurdity' },
  { id: 'old-school', tier: 508, triggerClick: 80085, name: 'Old School', description: 'Classic calculator' },
  { id: 'double-blaze', tier: 509, triggerClick: 420420, name: 'Double Blaze', description: 'Extra baked' },
  { id: 'maximum-evil', tier: 510, triggerClick: 666666, name: 'Maximum Evil', description: 'Maximum evil' },
  { id: 'nice-nice-nice', tier: 511, triggerClick: 696969, name: 'Nice Nice Nice', description: 'So nice' },

  // Ones family (520-523)
  { id: 'triple-ones', tier: 520, triggerClick: 111, name: 'Triple Ones', description: '111' },
  { id: 'quad-ones', tier: 521, triggerClick: 1111, name: 'Quad Ones', description: '1111' },
  { id: 'make-a-wish', tier: 522, triggerClick: 11111, name: 'Make a Wish', description: '11:11' },
  { id: 'six-ones', tier: 523, triggerClick: 111111, name: 'Six Ones', description: '111111' },

  // Sevens family (524-526)
  { id: 'jackpot', tier: 524, triggerClick: 7777, name: 'Jackpot', description: '7777' },
  { id: 'mega-jackpot', tier: 525, triggerClick: 77777, name: 'Mega Jackpot', description: '77777' },
  { id: 'slot-machine-god', tier: 526, triggerClick: 777777, name: 'Slot Machine God', description: '777777' },

  // Eights family (527-529)
  { id: 'prosperity', tier: 527, triggerClick: 888, name: 'Prosperity', description: 'Lucky in Chinese' },
  { id: 'very-lucky', tier: 528, triggerClick: 8888, name: 'Very Lucky', description: '8888' },
  { id: 'fortune', tier: 529, triggerClick: 888888, name: 'Fortune', description: '888888' },

  // Nines family (530-532)
  { id: 'so-close', tier: 530, triggerClick: 999, name: 'So Close', description: '999' },
  { id: 'edge-lord', tier: 531, triggerClick: 9999, name: 'Edge Lord', description: '9999' },
  { id: 'one-away', tier: 532, triggerClick: 999999, name: 'One Away', description: '999999' },

  // Palindromes (540-545)
  { id: 'binary-palindrome', tier: 540, triggerClick: 101, name: 'Binary Palindrome', description: '101' },
  { id: 'bookends', tier: 541, triggerClick: 1001, name: 'Bookends', description: '1001' },
  { id: 'symmetric', tier: 542, triggerClick: 10001, name: 'Symmetric', description: '10001' },
  { id: 'counting-palindrome', tier: 543, triggerClick: 12321, name: 'Counting Palindrome', description: '12321' },
  { id: 'mirror-mirror', tier: 544, triggerClick: 123321, name: 'Mirror Mirror', description: '123321' },
  { id: 'the-mountain', tier: 545, triggerClick: 1234321, name: 'The Mountain', description: '1234321' },

  // Mathematical (560-566)
  { id: 'fine-structure', tier: 560, triggerClick: 137, name: 'Fine Structure', description: 'Physics constant' },
  { id: 'pi-day', tier: 561, triggerClick: 314, name: 'Pi Day', description: '3.14' },
  { id: 'golden', tier: 562, triggerClick: 1618, name: 'Golden', description: 'Golden ratio' },
  { id: 'eulers-click', tier: 563, triggerClick: 2718, name: "Euler's Click", description: "Euler's number" },
  { id: 'more-pi', tier: 564, triggerClick: 3141, name: 'More Pi', description: '3.141' },
  { id: 'pi-squared', tier: 565, triggerClick: 31415, name: 'Pi Squared', description: '3.1415' },
  { id: 'full-pi', tier: 566, triggerClick: 314159, name: 'Full Pi', description: '3.14159' },

  // Powers of 2 (580-588)
  { id: 'byte', tier: 580, triggerClick: 256, name: 'Byte', description: '2^8' },
  { id: 'half-k', tier: 581, triggerClick: 512, name: 'Half K', description: '2^9' },
  { id: 'kilobyte', tier: 582, triggerClick: 1024, name: 'Kilobyte', description: '2^10' },
  { id: 'the-game', tier: 583, triggerClick: 2048, name: 'The Game', description: '2^11' },
  { id: 'pow-2-12', tier: 584, triggerClick: 4096, name: '2^12', description: '2^12' },
  { id: 'pow-2-13', tier: 585, triggerClick: 8192, name: '2^13', description: '2^13' },
  { id: 'pow-2-14', tier: 586, triggerClick: 16384, name: '2^14', description: '2^14' },
  { id: 'pow-2-15', tier: 587, triggerClick: 32768, name: '2^15', description: '2^15' },
  { id: 'pow-2-16', tier: 588, triggerClick: 65536, name: '2^16', description: '2^16' },

  // Cultural (600-609)
  { id: 'not-found', tier: 600, triggerClick: 404, name: 'Not Found', description: 'HTTP 404' },
  { id: 'server-error', tier: 601, triggerClick: 500, name: 'Server Error', description: 'HTTP 500' },
  { id: 'jumbo', tier: 602, triggerClick: 747, name: 'Jumbo', description: 'Boeing 747' },
  { id: 'emergency', tier: 603, triggerClick: 911, name: 'Emergency', description: 'Emergency services' },
  { id: 'orwellian', tier: 604, triggerClick: 1984, name: 'Orwellian', description: 'Big Brother' },
  { id: 'space-odyssey', tier: 605, triggerClick: 2001, name: 'Space Odyssey', description: 'Kubrick film' },
  { id: 'end-times', tier: 606, triggerClick: 2012, name: 'End Times', description: 'Mayan apocalypse' },
  { id: 'love-you-3000', tier: 607, triggerClick: 3000, name: 'Love You 3000', description: 'MCU reference' },
  { id: 'meaning-of-everything', tier: 608, triggerClick: 42, name: 'Meaning of Everything', description: "Hitchhiker's Guide" },
  { id: 'seasons-of-love', tier: 609, triggerClick: 525600, name: 'Seasons of Love', description: 'Minutes in a year' },
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
const CLICKS_KEY = (addr) => `clickstr:clicks:${addr.toLowerCase()}`;
const LEADERBOARD_KEY = 'clickstr:leaderboard';
const ONCHAIN_LEADERBOARD_KEY = 'clickstr:onchain-leaderboard'; // Tracks on-chain submissions via frontend
const MILESTONES_KEY = (addr) => `clickstr:milestones:${addr.toLowerCase()}`;
const ACHIEVEMENTS_KEY = (addr) => `clickstr:achievements:${addr.toLowerCase()}`;
const ELIGIBLE_KEY = 'clickstr:nft-eligible';
const GLOBAL_CLICKS_KEY = 'clickstr:global-clicks';
const GLOBAL_MILESTONES_KEY = 'clickstr:global-milestones'; // Hash: milestoneId -> winner address
const STREAK_KEY = (addr) => `clickstr:streak:${addr.toLowerCase()}`;
const TIME_CLICKS_KEY = (addr) => `clickstr:time-clicks:${addr.toLowerCase()}`; // Hash for time-based tracking
const HUMAN_SESSION_KEY = (addr) => `clickstr:human-session:${addr.toLowerCase()}`; // Turnstile verification session
const HEARTBEAT_KEY = (addr) => `clickstr:heartbeat:${addr.toLowerCase()}`; // Active frontend session heartbeat
const ACTIVE_USERS_SET = 'clickstr:active-users'; // Sorted set of active users (score = timestamp)

// =============================================================================
// CONSTANTS
// =============================================================================
const HEARTBEAT_TTL = 60; // Heartbeat expires after 60 seconds
const ACTIVE_USER_WINDOW = 60 * 1000; // Consider users active if heartbeat within 60 seconds
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

      // Active users request (for "clicking now" display)
      if (req.query.activeUsers === 'true') {
        const now = Date.now();
        const cutoff = now - ACTIVE_USER_WINDOW;

        // Count users with heartbeat within the active window (O(log N) operation)
        const activeHumans = await redis.zcount(ACTIVE_USERS_SET, cutoff, '+inf');

        const globalClicks = parseInt(await redis.get(GLOBAL_CLICKS_KEY) || '0', 10);

        return res.status(200).json({
          success: true,
          activeHumans,
          activeBots: 0, // Bots are counted client-side from subgraph
          globalClicks
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
      const { address, clicks, onChainClicks, txHash, name, epoch, timestamp, turnstileToken, nonces, heartbeat } = body;

      // Validate address (required for all POST requests)
      if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid or missing address' });
      }

      const addr = address.toLowerCase();

      // -----------------------------------------------------------------------
      // HEARTBEAT - Track active frontend sessions
      // -----------------------------------------------------------------------
      if (heartbeat === true) {
        const now = Date.now();
        // Add user to sorted set with current timestamp as score
        // This allows efficient counting of users active within a time window
        await redis.zadd(ACTIVE_USERS_SET, { score: now, member: addr });

        // Clean up old entries (older than 2x the window to avoid constant cleanup)
        const cutoff = now - (ACTIVE_USER_WINDOW * 2);
        await redis.zremrangebyscore(ACTIVE_USERS_SET, 0, cutoff);

        return res.status(200).json({ success: true });
      }

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
