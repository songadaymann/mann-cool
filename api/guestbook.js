import { Redis } from '@upstash/redis';

const GUESTBOOK_KEY = 'guestbook_entries';
const MAX_ENTRIES = 100; // Keep last 100 entries

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

  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  try {
    // GET - Fetch all guestbook entries
    if (req.method === 'GET') {
      const entries = await redis.lrange(GUESTBOOK_KEY, 0, MAX_ENTRIES - 1) || [];
      return res.status(200).json({ entries });
    }

    // POST - Add new entry
    if (req.method === 'POST') {
      const { name, message, turnstileToken } = req.body || {};

      // Validate inputs
      if (!name || !message) {
        return res.status(400).json({ error: 'Name and message are required' });
      }

      if (name.length > 50) {
        return res.status(400).json({ error: 'Name too long (max 50 chars)' });
      }

      if (message.length > 500) {
        return res.status(400).json({ error: 'Message too long (max 500 chars)' });
      }

      // Verify Turnstile token (if configured)
      if (process.env.TURNSTILE_SECRET_KEY) {
        if (!turnstileToken) {
          return res.status(400).json({ error: 'Please complete the human verification' });
        }

        const turnstileResponse = await fetch(
          'https://challenges.cloudflare.com/turnstile/v0/siteverify',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              secret: process.env.TURNSTILE_SECRET_KEY,
              response: turnstileToken,
            }),
          }
        );

        const turnstileData = await turnstileResponse.json();
        
        if (!turnstileData.success) {
          return res.status(400).json({ error: 'Human verification failed. Please try again.' });
        }
      }

      // Create entry
      const entry = {
        id: Date.now().toString(),
        name: name.trim(),
        message: message.trim(),
        timestamp: new Date().toISOString(),
      };

      // Add to the front of the list (newest first)
      await redis.lpush(GUESTBOOK_KEY, JSON.stringify(entry));
      
      // Trim to keep only last MAX_ENTRIES
      await redis.ltrim(GUESTBOOK_KEY, 0, MAX_ENTRIES - 1);

      return res.status(200).json({ success: true, entry });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Guestbook error:', error);
    return res.status(500).json({ error: 'Server error', message: error.message });
  }
}




