const { Redis } = require('@upstash/redis');

// Defensive: only create Redis client if env vars exist
let redis = null;
const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

if (url && token) {
  try {
    redis = new Redis({ url, token });
  } catch (e) {
    console.error('Failed to create Redis client:', e.message);
  }
}

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check if Redis is available
  if (!redis) {
    return res.status(503).json({ 
      error: 'Redis not configured',
      hasUrl: !!url,
      hasToken: !!token,
      counts: {} // Return empty counts so frontend doesn't break
    });
  }

  try {
    // GET - fetch all play counts
    if (req.method === 'GET') {
      const { slug } = req.query;
      
      if (slug) {
        // Get single game count
        const count = await redis.get(`plays:${slug}`) || 0;
        return res.status(200).json({ slug, count: Number(count) });
      } else {
        // Get all game counts
        const keys = await redis.keys('plays:*');
        const counts = {};
        
        if (keys.length > 0) {
          const values = await redis.mget(...keys);
          keys.forEach((key, index) => {
            const gameSlug = key.replace('plays:', '');
            counts[gameSlug] = Number(values[index]) || 0;
          });
        }
        
        return res.status(200).json({ counts });
      }
    }

    // POST - increment play count
    if (req.method === 'POST') {
      const { slug, source } = req.body;
      
      if (!slug) {
        return res.status(400).json({ error: 'slug is required' });
      }

      // Increment total plays for this game
      const newCount = await redis.incr(`plays:${slug}`);
      
      // Also track by source (mann.cool vs direct)
      if (source) {
        await redis.incr(`plays:${slug}:${source}`);
      }

      return res.status(200).json({ 
        slug, 
        count: newCount,
        message: 'Play recorded' 
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Redis error:', error.message);
    return res.status(500).json({ 
      error: 'Database error', 
      message: error.message,
      counts: {} // Return empty counts so frontend doesn't break
    });
  }
};
