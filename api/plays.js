const { Redis } = require('@upstash/redis');

module.exports = async function handler(req, res) {
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

  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  try {
    // GET - Fetch play counts
    if (req.method === 'GET') {
      const { slug } = req.query;
      
      if (slug) {
        // Get single game count
        const count = await redis.get(`plays:${slug}`) || 0;
        return res.status(200).json({ slug, count: parseInt(count, 10) });
      } else {
        // Get all counts - scan for plays:* keys
        const keys = await redis.keys('plays:*');
        const counts = {};
        
        if (keys.length > 0) {
          const values = await redis.mget(...keys);
          keys.forEach((key, i) => {
            const gameSlug = key.replace('plays:', '');
            counts[gameSlug] = parseInt(values[i] || 0, 10);
          });
        }
        
        return res.status(200).json({ counts, envCheck, keysFound: keys.length });
      }
    }

    // POST - Increment play count
    if (req.method === 'POST') {
      const { slug, source } = req.body || {};
      
      if (!slug) {
        return res.status(400).json({ error: 'Missing slug' });
      }

      const newCount = await redis.incr(`plays:${slug}`);
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
      envCheck
    });
  }
};
