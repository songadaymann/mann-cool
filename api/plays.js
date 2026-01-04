import { Redis } from '@upstash/redis';

// Use a single hash key to store all play counts (more efficient than keys())
const PLAYS_HASH_KEY = 'game_plays';

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check what env vars are available
  const envCheck = {
    hasKvUrl: !!process.env.KV_REST_API_URL,
    hasKvToken: !!process.env.KV_REST_API_TOKEN,
  };

  // Verify Redis is configured
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ 
      error: 'Redis not configured', 
      envCheck,
      debug: 'Missing KV_REST_API_URL or KV_REST_API_TOKEN'
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
      message: initError.message,
      envCheck
    });
  }

  try {
    // GET - Fetch play counts
    if (req.method === 'GET') {
      const { slug } = req.query;
      
      if (slug) {
        // Get single game count from hash
        const count = await redis.hget(PLAYS_HASH_KEY, slug) || 0;
        return res.status(200).json({ slug, count: parseInt(count, 10) });
      } else {
        // Get all counts from hash (single operation, no keys() needed)
        const allCounts = await redis.hgetall(PLAYS_HASH_KEY) || {};
        const counts = {};
        
        // Convert string values to integers
        for (const [key, value] of Object.entries(allCounts)) {
          counts[key] = parseInt(value || 0, 10);
        }
        
        return res.status(200).json({ counts, envCheck });
      }
    }

    // POST - Increment play count
    if (req.method === 'POST') {
      const { slug, source } = req.body || {};
      
      if (!slug) {
        return res.status(400).json({ error: 'Missing slug' });
      }

      // Use HINCRBY to atomically increment the count in the hash
      const newCount = await redis.hincrby(PLAYS_HASH_KEY, slug, 1);
      return res.status(200).json({ 
        slug, 
        count: newCount, 
        message: 'Play recorded',
        source: source || 'unknown'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    return res.status(500).json({ 
      error: 'Redis error', 
      message: error.message,
      stack: error.stack,
      envCheck
    });
  }
};
