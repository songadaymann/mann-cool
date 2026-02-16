import fs from 'fs';
import path from 'path';
import { Redis } from '@upstash/redis';
import { createPublicClient, http } from 'viem';
import { base, mainnet, sepolia } from 'viem/chains';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadEnv() {
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, '.env'));
  loadEnvFile(path.join(cwd, '.env.local'));
  loadEnvFile(path.join(cwd, '.env.development.local'));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    season: null,
    chunk: 1000,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--season' && args[i + 1]) {
      out.season = Number.parseInt(args[++i], 10);
    } else if (a === '--chunk' && args[i + 1]) {
      out.chunk = Number.parseInt(args[++i], 10);
    }
  }
  return out;
}

const CLICK_LOG_KEY = 'clickstr:click-log';
const V2_CLICKS_KEY = (addr, season, epoch) => `clickstr:v2:clicks:${addr.toLowerCase()}:${season}:${epoch}`;
const V2_EPOCH_LEADERBOARD_KEY = (season, epoch) => `clickstr:v2:leaderboard:${season}:${epoch}`;
const V2_EPOCH_TOTAL_KEY = (season, epoch) => `clickstr:v2:epoch-total:${season}:${epoch}`;

const GAME_ABI = [
  {
    name: 'SEASON_NUMBER',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'TOTAL_EPOCHS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'EPOCH_DURATION',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'gameStartTime',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

function getChainConfig(chainId) {
  if (chainId === 1) return { chain: mainnet, defaultRpc: 'https://eth.llamarpc.com' };
  if (chainId === 8453) return { chain: base, defaultRpc: 'https://mainnet.base.org' };
  return { chain: sepolia, defaultRpc: 'https://sepolia.infura.io/v3/your-key' };
}

async function main() {
  loadEnv();
  const { season: seasonArg, chunk } = parseArgs();
  const chunkSize = Number.isFinite(chunk) && chunk > 0 ? chunk : 1000;

  const redisUrl = process.env.KV_REST_API_URL;
  const redisToken = process.env.KV_REST_API_TOKEN;
  const gameAddress = process.env.CLICKSTR_GAME_V2_ADDRESS;
  const chainId = Number.parseInt(process.env.CHAIN_ID || '8453', 10);
  const { chain, defaultRpc } = getChainConfig(chainId);
  const rpcUrl = process.env.RPC_URL || defaultRpc;

  if (!redisUrl || !redisToken) {
    throw new Error('Missing KV_REST_API_URL / KV_REST_API_TOKEN');
  }
  if (!gameAddress) {
    throw new Error('Missing CLICKSTR_GAME_V2_ADDRESS');
  }

  const redis = new Redis({ url: redisUrl, token: redisToken });
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  const [seasonRaw, totalEpochsRaw, epochDurationRaw, gameStartRaw] = await Promise.all([
    client.readContract({ address: gameAddress, abi: GAME_ABI, functionName: 'SEASON_NUMBER' }),
    client.readContract({ address: gameAddress, abi: GAME_ABI, functionName: 'TOTAL_EPOCHS' }),
    client.readContract({ address: gameAddress, abi: GAME_ABI, functionName: 'EPOCH_DURATION' }),
    client.readContract({ address: gameAddress, abi: GAME_ABI, functionName: 'gameStartTime' }),
  ]);

  const onChainSeason = Number(seasonRaw);
  const seasonNumber = seasonArg ?? onChainSeason;
  if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) {
    throw new Error(`Invalid season number: ${seasonNumber}`);
  }

  const totalEpochs = Number(totalEpochsRaw);
  const epochDuration = Number(epochDurationRaw);
  const gameStartSec = Number(gameStartRaw);
  if (!Number.isFinite(totalEpochs) || totalEpochs <= 0) {
    throw new Error(`Invalid totalEpochs: ${totalEpochs}`);
  }
  if (!Number.isFinite(epochDuration) || epochDuration <= 0) {
    throw new Error(`Invalid epochDuration: ${epochDuration}`);
  }
  if (!Number.isFinite(gameStartSec) || gameStartSec <= 0) {
    throw new Error(`Invalid gameStartTime: ${gameStartSec}`);
  }

  const seasonStartMs = gameStartSec * 1000;
  const seasonEndMs = seasonStartMs + (totalEpochs * epochDuration * 1000);

  console.log('Backfill start');
  console.log(`- chainId: ${chainId}`);
  console.log(`- game: ${gameAddress}`);
  console.log(`- season: ${seasonNumber} (on-chain current: ${onChainSeason})`);
  console.log(`- epochs: ${totalEpochs}`);
  console.log(`- epochDuration: ${epochDuration}s`);
  console.log(`- seasonStart: ${new Date(seasonStartMs).toISOString()}`);
  console.log(`- seasonEnd:   ${new Date(seasonEndMs).toISOString()}`);
  console.log(`- chunkSize: ${chunkSize}`);

  const listLenRaw = await redis.llen(CLICK_LOG_KEY);
  const listLen = Number(listLenRaw || 0);
  if (!Number.isFinite(listLen) || listLen <= 0) {
    console.log('No click log entries found.');
    return;
  }
  console.log(`- click-log length: ${listLen}`);

  /** @type {Map<number, number>} */
  const epochTotals = new Map();
  /** @type {Map<number, Map<string, number>>} */
  const epochAddressTotals = new Map();

  let scannedEntries = 0;
  let matchedEntries = 0;
  let reachedBeforeStart = false;

  for (let end = listLen - 1; end >= 0; end -= chunkSize) {
    const start = Math.max(0, end - chunkSize + 1);
    const entriesRaw = await redis.lrange(CLICK_LOG_KEY, start, end);
    const entries = Array.isArray(entriesRaw) ? entriesRaw : [];

    for (let i = entries.length - 1; i >= 0; i--) {
      scannedEntries++;
      const raw = entries[i];
      let row;
      try {
        row = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {
        continue;
      }
      if (!row || typeof row !== 'object') continue;

      const tsMs = Number(row.t || 0);
      if (!Number.isFinite(tsMs) || tsMs <= 0) continue;

      if (tsMs < seasonStartMs) {
        reachedBeforeStart = true;
        break;
      }
      if (tsMs >= seasonEndMs) continue;

      const addr = typeof row.a === 'string' ? row.a.toLowerCase() : '';
      const clicks = Number(row.c || 0);
      if (!addr || !Number.isFinite(clicks) || clicks <= 0) continue;

      const tsSec = Math.floor(tsMs / 1000);
      const epoch = Math.floor((tsSec - gameStartSec) / epochDuration) + 1;
      if (!Number.isFinite(epoch) || epoch < 1 || epoch > totalEpochs) continue;

      matchedEntries++;
      epochTotals.set(epoch, (epochTotals.get(epoch) || 0) + clicks);

      const perAddr = epochAddressTotals.get(epoch) || new Map();
      perAddr.set(addr, (perAddr.get(addr) || 0) + clicks);
      epochAddressTotals.set(epoch, perAddr);
    }

    if (reachedBeforeStart) break;
  }

  console.log(`- scanned entries: ${scannedEntries}`);
  console.log(`- matched entries in season window: ${matchedEntries}`);

  const epochsToWrite = Array.from(epochTotals.keys()).sort((a, b) => a - b);
  console.log(`- epochs with data: ${epochsToWrite.length > 0 ? epochsToWrite.join(', ') : '(none)'}`);

  let writes = 0;
  for (const epoch of epochsToWrite) {
    const total = epochTotals.get(epoch) || 0;
    await redis.set(V2_EPOCH_TOTAL_KEY(seasonNumber, epoch), total);
    writes++;

    const perAddr = epochAddressTotals.get(epoch) || new Map();
    const entries = Array.from(perAddr.entries());
    const batchSize = 250;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await Promise.all(
        batch.flatMap(([addr, clicks]) => ([
          redis.set(V2_CLICKS_KEY(addr, seasonNumber, epoch), clicks),
          redis.zadd(V2_EPOCH_LEADERBOARD_KEY(seasonNumber, epoch), {
            score: clicks,
            member: JSON.stringify({ address: addr }),
          }),
        ]))
      );
      writes += batch.length * 2;
    }
  }

  console.log(`- writes completed: ${writes}`);
  console.log('Backfill complete. Legacy keys were not deleted.');
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

