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
    hasUpstashUrl: !!process.env.UPSTASH_REDIS_REST_URL,
    hasUpstashToken: !!process.env.UPSTASH_REDIS_REST_TOKEN,
  };

  // Just return diagnostic info for now
  return res.status(200).json({ 
    status: 'ok',
    envCheck,
    counts: {}
  });
};
