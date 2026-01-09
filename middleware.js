// Vercel Edge Middleware for dynamic OG tags
// This runs on every request and injects correct meta tags for social sharing

// Game data embedded (sync with games.json when adding games)
const games = [
  { slug: 'coldplay-canoodle', title: 'Coldplay Canoodle', image: '/nes-game-images/coldplay-canoodle.png' },
  { slug: 'ctn', title: 'Crypto Tax Nightmare', image: '/nes-game-images/crypto-tax-nightmare.png' },
  { slug: 'windows', title: "Windows Didn't Load Correctly", image: "/nes-game-images/windows-didn't-load.png" },
  { slug: 'tallgrass', title: 'Tall Grass', image: '/nes-game-images/tall-grass.png' },
  { slug: 'chonksisyphus', title: 'Sisyphus Chonk', image: '/nes-game-images/sisyphus-chonk.png' },
  { slug: 'oil', title: 'Oil & Epstein', image: '/nes-game-images/oil.png' },
  { slug: 'loki', title: 'Loki Is Genderfluid', image: '/nes-game-images/loki.png' },
  { slug: 'pong', title: 'Anybody // Pong', image: '/nes-game-images/pong.png' },
  { slug: 'rcs', title: 'Right-Click Save Kill', image: '/nes-game-images/rcs.png' },
  { slug: 'kevin', title: 'Kevin', image: '/nes-game-images/kevin.png' },
  { slug: 'fuckice', title: 'FUCK ICE', image: '/nes-game-images/fuckice.png' },
];

// User agents for social media crawlers
const CRAWLER_USER_AGENTS = [
  'facebookexternalhit',
  'Facebot',
  'Twitterbot',
  'LinkedInBot',
  'Pinterest',
  'Slackbot',
  'TelegramBot',
  'WhatsApp',
  'Discordbot',
];

function isCrawler(userAgent) {
  if (!userAgent) return false;
  return CRAWLER_USER_AGENTS.some(crawler => 
    userAgent.toLowerCase().includes(crawler.toLowerCase())
  );
}

function getGameFromPath(pathname) {
  const slug = pathname.replace(/^\//, '').split('/')[0];
  return games.find(g => g.slug === slug);
}

function generateOGHtml(game, baseUrl) {
  const title = game ? `${game.title} | mann.cool` : 'mann.cool - Games by Jonathan Mann';
  const description = game 
    ? `Play ${game.title} - a game by Jonathan Mann`
    : 'Play games by Jonathan Mann, the Song A Day man';
  const image = game 
    ? `${baseUrl}${game.image}` 
    : `${baseUrl}/nes-game-images/coldplay-canoodle.png`;
  const url = game ? `${baseUrl}/${game.slug}` : baseUrl;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:image" content="${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${image}">
  
  <!-- Redirect non-crawlers to the actual app -->
  <meta http-equiv="refresh" content="0;url=${url}">
</head>
<body>
  <p>Redirecting to <a href="${url}">${title}</a>...</p>
</body>
</html>`;
}

export default function middleware(request) {
  const userAgent = request.headers.get('user-agent') || '';
  const url = new URL(request.url);
  
  // Only intercept for crawlers on game routes
  if (isCrawler(userAgent)) {
    const game = getGameFromPath(url.pathname);
    
    // Only generate custom HTML if it's a game route or home
    if (game || url.pathname === '/') {
      const baseUrl = `${url.protocol}//${url.host}`;
      const html = generateOGHtml(game, baseUrl);
      
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
  }
  
  // For normal users, continue to the app
  return;
}

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next|api|favicon.ico|nes-game-images|assets|.*\\.[a-zA-Z0-9]+$).*)',
  ],
};
