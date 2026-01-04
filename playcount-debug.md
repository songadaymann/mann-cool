# Play Count Feature - Debug Log

## Goal
Add play count tracking to mann.cool games using Upstash Redis, displaying counts on game cards.

## Setup
- **Database**: Upstash Redis (connected via Vercel Marketplace)
- **API Route**: `/api/plays.js` - serverless function for GET/POST play counts
- **Frontend**: React context in App.jsx to fetch/display counts

---

## Issues Encountered & Solutions

### Issue 1: ES Module Syntax Not Supported
**Error**: `SyntaxError: Unexpected token 'i', "import { R"...`

**Cause**: Vercel serverless functions expect CommonJS by default.

**Fix**: Changed from ES modules to CommonJS:
```javascript
// Before (broken)
import { Redis } from '@upstash/redis';
export default async function handler(req, res) { ... }

// After (fixed)
const { Redis } = require('@upstash/redis');
module.exports = async function handler(req, res) { ... }
```

---

### Issue 2: Wrong Environment Variable Names
**Error**: 500 Internal Server Error - Redis not configured

**Cause**: Code was looking for `UPSTASH_REDIS_REST_URL` but Vercel/Upstash sets `KV_REST_API_URL`.

**Environment variables available**:
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN`
- `KV_URL`
- `REDIS_URL`

**Fix**: Updated code to use correct env var names:
```javascript
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});
```

**Note**: `Redis.fromEnv()` looks for `UPSTASH_REDIS_REST_*` vars, not `KV_*`.

---

### Issue 3: Catch-All Rewrite Intercepting API Routes
**Error**: `FUNCTION_INVOCATION_FAILED` - function crashes before code runs

**Cause**: `vercel.json` had a catch-all rewrite that was intercepting `/api/` routes:
```json
{
  "source": "/(.*)",
  "destination": "/index.html"
}
```

This sent `/api/plays` to `index.html` instead of the serverless function.

**Fix**: Reordered rewrites so API routes come first:
```json
{
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api/$1"
    },
    // ... other rewrites ...
    {
      "source": "/:path*",
      "destination": "/index.html"
    }
  ]
}
```

---

### Issue 4: Invalid Runtime Format
**Error**: `Function Runtimes must have a valid version, for example 'now-php@1.0.0'`

**Cause**: Tried to specify runtime as `nodejs20.x` which is incorrect format.

**Fix**: Removed explicit functions config - let Vercel auto-detect:
```json
// Removed this:
"functions": {
  "api/*.js": {
    "runtime": "nodejs20.x"  // Wrong format!
  }
}
```

---

### Issue 5: Local Development - API Not Available
**Error**: `SyntaxError: Unexpected token 'c', "const { Re"...` (locally)

**Cause**: Vite dev server doesn't run Vercel serverless functions. Requests to `/api/plays` return the raw JS source code.

**Workaround**: The API only works in production (on Vercel). Locally, the fetch fails gracefully and returns empty counts.

---

## Current Status

### What's Working
- [x] Upstash Redis connected to Vercel project
- [x] Environment variables configured in Vercel
- [x] API route file created (`api/plays.js`)
- [x] Frontend code to fetch/display counts
- [x] CSS for play count badges
- [x] vercel.json rewrites fixed

### What's Pending
- [ ] Verify API returns JSON after latest deploy
- [ ] Test play count increment when visiting games
- [ ] Verify counts display on game cards

---

## Files Modified

1. **`api/plays.js`** - Serverless function for Redis operations
2. **`src/App.jsx`** - Added PlayCountsContext, usePlayCounts hook, display on GameCard
3. **`src/styles.css`** - Added .play-count badge styles
4. **`vercel.json`** - Fixed rewrites to not intercept /api/ routes
5. **`package.json`** - Added @upstash/redis dependency

---

## API Endpoints

### GET /api/plays
Returns all play counts:
```json
{
  "counts": {
    "coldplay-canoodle": 5,
    "ctn": 12,
    "windows": 3
  }
}
```

### GET /api/plays?slug=windows
Returns single game count:
```json
{
  "slug": "windows",
  "count": 3
}
```

### POST /api/plays
Increments play count:
```json
// Request body
{ "slug": "windows", "source": "mann.cool" }

// Response
{ "slug": "windows", "count": 4, "message": "Play recorded" }
```

---

## Environment Variables Required

In Vercel Dashboard → Settings → Environment Variables:
- `KV_REST_API_URL` - Upstash Redis REST URL
- `KV_REST_API_TOKEN` - Upstash Redis REST token

These are automatically added when connecting Upstash via Vercel Marketplace.

---

## Testing

```bash
# Test API directly
curl https://www.mann.cool/api/plays

# Expected response
{"status":"ok","envCheck":{"hasKvUrl":true,"hasKvToken":true,...},"counts":{}}
```

---

## Related: WalletConnect/Reown 403 Error

Separate issue: `Origin https://www.mann.cool not found on Allowlist`

**Fix**: Go to cloud.reown.com → Project Settings → Add `www.mann.cool` to allowed domains (in addition to `mann.cool`).

