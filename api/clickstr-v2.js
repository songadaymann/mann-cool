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
  }
];

// Proof-of-work configuration
const POW_DIFFICULTY_TARGET = BigInt(process.env.POW_DIFFICULTY_TARGET || '0x00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

// Session configuration
const HUMAN_SESSION_DURATION = 60 * 60 * 1000; // 1 hour
const CLICKS_BEFORE_VERIFICATION = 500;
const CLAIM_CHALLENGE_TTL_SECONDS = 60 * 5; // 5 minutes

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

// Reuse V1 keys for cross-version compatibility
const MILESTONES_KEY = (addr) => `clickstr:milestones:${addr.toLowerCase()}`;
const ACHIEVEMENTS_KEY = (addr) => `clickstr:achievements:${addr.toLowerCase()}`;
const ELIGIBLE_KEY = 'clickstr:nft-eligible';
const GLOBAL_MILESTONES_KEY = 'clickstr:global-milestones';
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

const GLOBAL_MILESTONES = [
  { id: 'global-1', tier: 200, globalClick: 1, name: 'The First Click' },
  { id: 'global-10', tier: 201, globalClick: 10, name: 'The Tenth' },
  { id: 'global-100', tier: 202, globalClick: 100, name: 'Century' },
  { id: 'global-1000', tier: 203, globalClick: 1000, name: 'Thousandaire' },
  { id: 'global-10000', tier: 204, globalClick: 10000, name: 'Ten Grand' },
  { id: 'global-100000', tier: 205, globalClick: 100000, name: 'The Hundred Thousandth' },
  { id: 'global-1000000', tier: 206, globalClick: 1000000, name: 'The Millionth Click' },
  // ... more globals as needed
];

const HIDDEN_ACHIEVEMENTS = [
  { id: 'nice', tier: 500, triggerClick: 69, name: 'Nice' },
  { id: 'blaze-it', tier: 501, triggerClick: 420, name: 'Blaze It' },
  { id: 'devils-click', tier: 502, triggerClick: 666, name: "Devil's Click" },
  { id: 'lucky-7s', tier: 503, triggerClick: 777, name: 'Lucky 7s' },
  { id: 'elite', tier: 504, triggerClick: 1337, name: 'Elite' },
  // ... more hidden as needed (import full list from clickstr.js if needed)
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
    console.error('Error reading registry:', error);
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
 * Get current game state from contract
 */
async function getGameState() {
  if (!GAME_CONTRACT_ADDRESS) {
    return { currentEpoch: 1, seasonNumber: 2, totalEpochs: 3, gameStarted: false, gameEnded: false };
  }

  try {
    const client = getPublicClient();
    const [currentEpoch, seasonNumber, totalEpochs, gameStarted, gameEnded] = await Promise.all([
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'currentEpoch' }),
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'SEASON_NUMBER' }),
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'TOTAL_EPOCHS' }),
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'gameStarted' }),
      client.readContract({ address: GAME_CONTRACT_ADDRESS, abi: GAME_ABI, functionName: 'gameEnded' }),
    ]);
    return {
      currentEpoch: Number(currentEpoch),
      seasonNumber: Number(seasonNumber),
      totalEpochs: Number(totalEpochs),
      gameStarted,
      gameEnded
    };
  } catch (error) {
    console.error('Error reading game state:', error);
    return { currentEpoch: 1, seasonNumber: 2, totalEpochs: 3, gameStarted: false, gameEnded: false };
  }
}

/**
 * Verify a proof-of-work nonce
 */
function verifyNonce(address, nonceStr, epoch) {
  try {
    const nonce = BigInt(nonceStr);
    const packed = encodePacked(
      ['address', 'uint256', 'uint256', 'uint256'],
      [address, nonce, BigInt(epoch), BigInt(CHAIN_ID)]
    );
    const hash = keccak256(packed);
    const hashBigInt = BigInt(hash);
    return hashBigInt < POW_DIFFICULTY_TARGET;
  } catch (error) {
    console.error('Nonce verification error:', error);
    return false;
  }
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
      const { address, leaderboard, claimable, activeUsers, epoch: queryEpoch, limit = '50' } = req.query;

      // Get current game state
      const gameState = await getGameState();

      // Leaderboard request
      if (leaderboard === 'true') {
        const epochNum = queryEpoch ? parseInt(queryEpoch, 10) : gameState.currentEpoch;
        const limitNum = Math.min(parseInt(limit, 10) || 50, 100);

        const entries = await redis.zrange(V2_EPOCH_LEADERBOARD_KEY(epochNum), 0, limitNum - 1, {
          rev: true,
          withScores: true
        });

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

        const epochTotal = parseInt(await redis.get(V2_EPOCH_TOTAL_KEY(epochNum)) || '0', 10);

        return res.status(200).json({
          success: true,
          epoch: epochNum,
          leaderboard: parsed,
          epochTotalClicks: epochTotal,
          gameState
        });
      }

      // Active users request
      if (activeUsers === 'true') {
        const cutoffTime = Date.now() - (60 * 1000); // 60 seconds ago
        // Count users with heartbeat in last 60 seconds
        const activeCount = await redis.zcount(ACTIVE_USERS_SET, cutoffTime, '+inf');
        // Get global clicks
        const globalClicks = parseInt(await redis.get(V2_GLOBAL_CLICKS_KEY) || '0', 10);

        return res.status(200).json({
          success: true,
          activeHumans: activeCount || 0,
          activeBots: 0, // V2 is human-only
          globalClicks
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
      const registryClicks = await getRegistryClicks(addr);

      // Total is max of Redis (current season unclaimed) + registry (claimed across all seasons)
      // Note: Once claimed, clicks move from Redis tracking to registry
      const lifetimeClicks = Math.max(redisTotal, Number(registryClicks));

      // Get rank in current epoch
      const rank = await redis.zrevrank(
        V2_EPOCH_LEADERBOARD_KEY(gameState.currentEpoch),
        JSON.stringify({ address: addr })
      );

      // Get milestones/achievements (shared with V1)
      const unlockedMilestones = await redis.smembers(MILESTONES_KEY(addr)) || [];
      const unlockedAchievements = await redis.smembers(ACHIEVEMENTS_KEY(addr)) || [];

      return res.status(200).json({
        success: true,
        address: addr,
        currentEpochClicks,
        seasonClicks: redisTotal,
        lifetimeClicks,
        registryClicks: Number(registryClicks),
        rank: rank !== null ? rank + 1 : null,
        milestones: unlockedMilestones,
        achievements: unlockedAchievements,
        gameState
      });
    }

    // =========================================================================
    // POST REQUESTS
    // =========================================================================
    if (req.method === 'POST') {
      const body = req.body || {};
      const { address, action, epoch: requestedEpoch, turnstileToken, nonces, heartbeat } = body;

      if (!validateAddress(address)) {
        return res.status(400).json({ error: 'Invalid or missing address' });
      }

      const addr = address.toLowerCase();
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

        // Check if already claimed on-chain
        const alreadyClaimed = await hasClaimedOnChain(addr, epoch);
        if (alreadyClaimed) {
          return res.status(400).json({ error: 'Already claimed on-chain' });
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
        const needsReverification = ipMismatch || missingIpBinding || sessionClicks >= CLICKS_BEFORE_VERIFICATION;

        if (!isSessionValid || needsReverification) {
          if (process.env.TURNSTILE_SECRET_KEY) {
            if (!turnstileToken) {
              const reason = !isSessionValid
                ? 'session_expired'
                : (ipMismatch || missingIpBinding) ? 'ip_mismatch' : 'click_limit';
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
              challengeData = JSON.parse(existing);
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
            const challengePayload = JSON.parse(existingChallenge);
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

        // Check if we already issued a signature (prevent replay farming)
        const existingSignature = await redis.get(V2_CLAIM_ISSUED_KEY(addr, epoch));
        if (existingSignature) {
          // Return existing signature (idempotent)
          const parsed = JSON.parse(existingSignature);
          return res.status(200).json({
            success: true,
            signature: parsed.signature,
            epoch,
            clickCount: parsed.clickCount,
            seasonNumber: gameState.seasonNumber,
            contractAddress: GAME_CONTRACT_ADDRESS,
            chainId: CHAIN_ID,
            note: 'Returning previously issued signature'
          });
        }

        // Generate signature
        const signature = await signClaimAttestation(
          addr,
          epoch,
          clicks,
          gameState.seasonNumber
        );

        // Store issued signature
        await redis.set(
          V2_CLAIM_ISSUED_KEY(addr, epoch),
          JSON.stringify({ signature, clickCount: clicks, issuedAt: Date.now() }),
          { ex: 86400 * 30 } // 30 day expiry
        );

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

      if (nonces.length > 1000) {
        return res.status(400).json({ error: 'Too many nonces (max 1000)' });
      }

      // Determine if game is active and which epoch to use
      const gameActive = gameState.gameStarted && !gameState.gameEnded;
      // When game is active, use current epoch; when inactive, use epoch 0 for PoW/dedup
      const epoch = gameActive ? gameState.currentEpoch : 0;
      const now = Date.now();

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
      const needsReverification = sessionClicks + nonces.length >= CLICKS_BEFORE_VERIFICATION
        || ipMismatch
        || missingIpBinding;

      if (!isSessionValid || needsReverification) {
        if (process.env.TURNSTILE_SECRET_KEY) {
          if (!turnstileToken) {
            const reason = !isSessionValid
              ? 'session_expired'
              : (ipMismatch || missingIpBinding) ? 'ip_mismatch' : 'click_limit';
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
        // Verify PoW
        if (!verifyNonce(addr, nonceStr, epoch)) {
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

      const previousGlobal = parseInt(await redis.get(V2_GLOBAL_CLICKS_KEY) || '0', 10);
      const newGlobal = previousGlobal + validCount;

      // Always update lifetime and global counts
      const updatePromises = [
        redis.set(V2_TOTAL_CLICKS_KEY(addr), newTotal),
        redis.set(V2_GLOBAL_CLICKS_KEY, newGlobal),
        redis.hincrby(HUMAN_SESSION_KEY(addr), 'clicksSinceVerify', validCount)
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

      // Log for retroactive attribution
      await redis.rpush(CLICK_LOG_KEY, JSON.stringify({
        a: addr,
        c: validCount,
        b: previousGlobal,
        f: newGlobal,
        t: now,
        v: 2 // Version marker
      }));

      // -----------------------------------------------------------------------
      // CHECK ACHIEVEMENTS (using combined total)
      // -----------------------------------------------------------------------
      const newMilestones = [];
      const newAchievements = [];

      // Get registry clicks for true lifetime total
      const registryClicks = await getRegistryClicks(addr);
      const lifetimeTotal = newTotal + Number(registryClicks);

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
        rank,
        gameActive,
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
