import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Routes, Route, Link, useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useRef, createContext, useContext } from "react";
import { AuctionBar } from "./components/auction/AuctionBar";
import gamesData from "../games.json";

// Import games from JSON (can be symlinked and edited from any game repo)
const games = gamesData.games;

// Play counts context
const PlayCountsContext = createContext({ counts: {}, trackPlay: () => {} });

function usePlayCounts() {
  return useContext(PlayCountsContext);
}

// Hook to manage play counts
function usePlayCountsProvider() {
  const [counts, setCounts] = useState({});

  // Fetch all play counts on mount
  useEffect(() => {
    fetch('/api/plays')
      .then(res => res.json())
      .then(data => {
        if (data.counts) {
          setCounts(data.counts);
        }
      })
      .catch(err => console.error('Failed to fetch play counts:', err));
  }, []);

  // Track a play
  const trackPlay = async (slug) => {
    try {
      const res = await fetch('/api/plays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, source: 'mann.cool' }),
      });
      const data = await res.json();
      if (data.count) {
        setCounts(prev => ({ ...prev, [slug]: data.count }));
      }
    } catch (err) {
      console.error('Failed to track play:', err);
    }
  };

  return { counts, trackPlay };
}

// Hook to detect mobile
function useIsMobile() {
  // Initialize with actual check to avoid flash/redirect issues
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 768 || "ontouchstart" in window;
  });

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768 || "ontouchstart" in window);
    };
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return isMobile;
}

// Virtual Joystick component for camera/look controls
function VirtualJoystick({ onMove, onEnd, label }) {
  const [isActive, setIsActive] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const stickRef = useRef(null);
  const centerRef = useRef({ x: 0, y: 0 });
  const animationRef = useRef(null);
  const positionRef = useRef({ x: 0, y: 0 }); // Use ref for animation loop

  const handleStart = (e) => {
    const rect = stickRef.current.getBoundingClientRect();
    centerRef.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    setIsActive(true);
    
    // Start continuous movement updates using ref (not stale state)
    const sendMovement = () => {
      const pos = positionRef.current;
      if (pos.x !== 0 || pos.y !== 0) {
        onMove(pos.x * 10, pos.y * 10); // Scale for sensitivity
      }
      animationRef.current = requestAnimationFrame(sendMovement);
    };
    animationRef.current = requestAnimationFrame(sendMovement);
  };

  const handleMove = (e) => {
    if (!isActive) return;
    
    const touch = e.touches ? e.touches[0] : e;
    const dx = touch.clientX - centerRef.current.x;
    const dy = touch.clientY - centerRef.current.y;
    
    // Clamp to joystick radius
    const maxRadius = 40;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const clampedDistance = Math.min(distance, maxRadius);
    const angle = Math.atan2(dy, dx);
    
    const clampedX = (Math.cos(angle) * clampedDistance) / maxRadius;
    const clampedY = (Math.sin(angle) * clampedDistance) / maxRadius;
    
    // Update both state (for visual) and ref (for animation loop)
    setPosition({ x: clampedX, y: clampedY });
    positionRef.current = { x: clampedX, y: clampedY };
  };

  const handleEnd = () => {
    setIsActive(false);
    setPosition({ x: 0, y: 0 });
    positionRef.current = { x: 0, y: 0 };
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    onEnd && onEnd();
  };

  return (
    <div
      ref={stickRef}
      className="virtual-joystick"
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
      onMouseDown={handleStart}
      onMouseMove={handleMove}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
    >
      <div className="joystick-base">
        <div
          className="joystick-knob"
          style={{
            transform: `translate(${position.x * 30}px, ${position.y * 30}px)`,
          }}
        />
      </div>
      <div className="joystick-label">{label || "LOOK"}</div>
    </div>
  );
}

// PICO-8 style console for desktop games on mobile
function PicoConsole({ game, onClose, showAuction = true }) {
  const iframeRef = useRef(null);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [keyboardText, setKeyboardText] = useState('');
  const textInputRef = useRef(null);

  // Listen for messages from the game iframe (e.g., keyboard requests)
  useEffect(() => {
    const handleMessage = (event) => {
      const { type, show } = event.data || {};

      if (type === 'requestKeyboard') {
        setShowKeyboard(show);
        setKeyboardText('');
        if (show) {
          setTimeout(() => textInputRef.current?.focus(), 100);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Send text input to the game
  const sendTextToGame = (text) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: 'textInputEvent', text },
        '*'
      );
    }
  };

  // Handle text input submission
  const handleTextSubmit = () => {
    if (keyboardText.trim()) {
      sendTextToGame(keyboardText.toUpperCase());
      setKeyboardText('');
      setShowKeyboard(false);
      refocusGame();
    }
  };

  // Refocus iframe to prevent pause - call after any button interaction
  const refocusGame = () => {
    if (iframeRef.current) {
      iframeRef.current.focus();
      // Also send a focus message to the game
      iframeRef.current.contentWindow?.postMessage({ type: "focusEvent" }, "*");
    }
  };

  const sendKey = (key, type) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "keyEvent", key, eventType: type },
        "*"
      );
    }
    refocusGame();
  };

  const sendClick = (type) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "clickEvent", eventType: type },
        "*"
      );
    }
    refocusGame();
  };

  const sendMouseMove = (deltaX, deltaY) => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "mouseMoveEvent", deltaX, deltaY },
        "*"
      );
    }
  };

  const handleButtonDown = (key, isClick, keys) => {
    if (isClick) {
      sendClick("mousedown");
    } else if (keys && Array.isArray(keys)) {
      // Send multiple keys
      keys.forEach(k => sendKey(k, "keydown"));
    } else {
      sendKey(key, "keydown");
    }
  };

  const handleButtonUp = (key, isClick, keys) => {
    if (isClick) {
      sendClick("mouseup");
    } else if (keys && Array.isArray(keys)) {
      // Release multiple keys
      keys.forEach(k => sendKey(k, "keyup"));
    } else {
      sendKey(key, "keyup");
    }
  };

  // Prevent any touch on the console from causing focus issues
  const handleConsoleTouchStart = (e) => {
    // Don't prevent if it's the close button
    if (e.target.closest('.pico-close')) return;
    // Prevent default to stop focus changes
    e.preventDefault();
  };

  const dpad = game.controls?.dpad || {};
  const actions = game.controls?.actions || [];
  const hasLookStick = game.controls?.hasLookStick || false;
  const lookHint = game.controls?.lookHint || null;
  
  // Check if game has wide aspect ratio (16:9 or wider) - these need expanded console
  const isWideGame = game.aspectRatio && (() => {
    const match = game.aspectRatio.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      const ratio = parseInt(match[1]) / parseInt(match[2]);
      return ratio >= 1.5; // 16:9 = 1.78, 4:3 = 1.33
    }
    return false;
  })();
  
  const hasMany = actions.length > 2 || hasLookStick || lookHint || isWideGame;

  return (
    <div 
      className="pico-fullscreen"
      onTouchStart={handleConsoleTouchStart}
      onTouchMove={(e) => { if (!e.target.closest('.pico-close')) e.preventDefault(); }}
    >
      <button className="pico-close" onClick={onClose}>
        ✕
      </button>

      {/* Keyboard overlay for text input (e.g., high score name entry) */}
      {showKeyboard && (
        <div className="pico-keyboard-overlay">
          <div className="pico-keyboard-modal">
            <div className="pico-keyboard-title">ENTER YOUR NAME</div>
            <input
              ref={textInputRef}
              type="text"
              className="pico-keyboard-input"
              value={keyboardText}
              onChange={(e) => setKeyboardText(e.target.value.slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTextSubmit();
              }}
              maxLength={8}
              autoComplete="off"
              autoCapitalize="characters"
            />
            <div className="pico-keyboard-buttons">
              <button
                className="pico-keyboard-btn pico-keyboard-cancel"
                onClick={() => setShowKeyboard(false)}
              >
                CANCEL
              </button>
              <button
                className="pico-keyboard-btn pico-keyboard-ok"
                onClick={handleTextSubmit}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`pico-console ${hasMany ? "pico-console-expanded" : ""}`}>
        <div className="pico-bezel">
          <div className="pico-screen-area">
            <div className="pico-screen-label">{game.title}</div>
            <div
              className="pico-screen"
              style={{ aspectRatio: game.aspectRatio || "1 / 1" }}
            >
              <iframe
                ref={iframeRef}
                src={game.gameUrl}
                title={game.title}
                className="pico-game-iframe"
                allow={`autoplay; fullscreen${game.permissions ? '; ' + game.permissions.join('; ') : ''}`}
              />
            </div>
          </div>

          <div className={`pico-controls ${hasMany ? "pico-controls-expanded" : ""} ${hasLookStick ? "pico-controls-3d" : ""}`}>
            {/* For 3D games: D-Pad and Look Stick side by side */}
            {hasLookStick ? (
              <div className="pico-sticks-row">
                {/* D-Pad */}
                <div className="pico-dpad">
                  <button
                    className="pico-btn pico-up"
                    onTouchStart={() => handleButtonDown(dpad.up)}
                    onTouchEnd={() => handleButtonUp(dpad.up)}
                    onMouseDown={() => handleButtonDown(dpad.up)}
                    onMouseUp={() => handleButtonUp(dpad.up)}
                  >
                    ▲
                  </button>
                  <button
                    className="pico-btn pico-left"
                    onTouchStart={() => handleButtonDown(dpad.left)}
                    onTouchEnd={() => handleButtonUp(dpad.left)}
                    onMouseDown={() => handleButtonDown(dpad.left)}
                    onMouseUp={() => handleButtonUp(dpad.left)}
                  >
                    ◀
                  </button>
                  <div className="pico-dpad-center"></div>
                  <button
                    className="pico-btn pico-right"
                    onTouchStart={() => handleButtonDown(dpad.right)}
                    onTouchEnd={() => handleButtonUp(dpad.right)}
                    onMouseDown={() => handleButtonDown(dpad.right)}
                    onMouseUp={() => handleButtonUp(dpad.right)}
                  >
                    ▶
                  </button>
                  <button
                    className="pico-btn pico-down"
                    onTouchStart={() => handleButtonDown(dpad.down)}
                    onTouchEnd={() => handleButtonUp(dpad.down)}
                    onMouseDown={() => handleButtonDown(dpad.down)}
                    onMouseUp={() => handleButtonUp(dpad.down)}
                  >
                    ▼
                  </button>
                </div>

                {/* Look Stick */}
                <VirtualJoystick
                  onMove={(dx, dy) => sendMouseMove(dx, dy)}
                  label="LOOK"
                />
              </div>
            ) : (
              /* For non-3D games: just the D-Pad */
              <div className="pico-dpad">
                <button
                  className="pico-btn pico-up"
                  onTouchStart={() => handleButtonDown(dpad.up)}
                  onTouchEnd={() => handleButtonUp(dpad.up)}
                  onMouseDown={() => handleButtonDown(dpad.up)}
                  onMouseUp={() => handleButtonUp(dpad.up)}
                >
                  ▲
                </button>
                <button
                  className="pico-btn pico-left"
                  onTouchStart={() => handleButtonDown(dpad.left)}
                  onTouchEnd={() => handleButtonUp(dpad.left)}
                  onMouseDown={() => handleButtonDown(dpad.left)}
                  onMouseUp={() => handleButtonUp(dpad.left)}
                >
                  ◀
                </button>
                <div className="pico-dpad-center"></div>
                <button
                  className="pico-btn pico-right"
                  onTouchStart={() => handleButtonDown(dpad.right)}
                  onTouchEnd={() => handleButtonUp(dpad.right)}
                  onMouseDown={() => handleButtonDown(dpad.right)}
                  onMouseUp={() => handleButtonUp(dpad.right)}
                >
                  ▶
                </button>
                <button
                  className="pico-btn pico-down"
                  onTouchStart={() => handleButtonDown(dpad.down)}
                  onTouchEnd={() => handleButtonUp(dpad.down)}
                  onMouseDown={() => handleButtonDown(dpad.down)}
                  onMouseUp={() => handleButtonUp(dpad.down)}
                >
                  ▼
                </button>
              </div>
            )}

            {/* Action Buttons - dynamically rendered */}
            <div className={`pico-action-buttons ${hasMany && !hasLookStick ? "pico-action-grid" : ""} ${actions.length === 1 ? "pico-single-button" : ""}`}>
              {actions.map((action, index) => (
                <button
                  key={index}
                  className={`pico-btn pico-btn-action pico-btn-${index}`}
                  onTouchStart={() => handleButtonDown(action.key, action.isClick, action.keys)}
                  onTouchEnd={() => handleButtonUp(action.key, action.isClick, action.keys)}
                  onMouseDown={() => handleButtonDown(action.key, action.isClick, action.keys)}
                  onMouseUp={() => handleButtonUp(action.key, action.isClick, action.keys)}
                >
                  {action.label}
                </button>
              ))}
            </div>

            {/* Look hint for games that use swipe-to-look */}
            {lookHint && (
              <div className="pico-look-hint">
                👆 {lookHint}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Fullscreen view for mobile games on mobile
function MobileFullscreen({ game, onClose }) {
  return (
    <div className="mobile-fullscreen">
      <button className="mobile-fullscreen-close" onClick={onClose}>
        ✕
      </button>
      <iframe
        src={game.gameUrl}
        title={game.title}
        className="mobile-fullscreen-iframe"
        allow={`autoplay; fullscreen${game.permissions ? '; ' + game.permissions.join('; ') : ''}`}
      />
    </div>
  );
}

// Landscape fullscreen view - for games that need phone rotation (no virtual controller)
function LandscapeFullscreen({ game, onClose }) {
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const checkOrientation = () => {
      // Check if width > height (landscape) or use screen.orientation if available
      const landscape = window.innerWidth > window.innerHeight;
      setIsLandscape(landscape);
    };
    
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    window.addEventListener("orientationchange", checkOrientation);
    
    return () => {
      window.removeEventListener("resize", checkOrientation);
      window.removeEventListener("orientationchange", checkOrientation);
    };
  }, []);

  if (!isLandscape) {
    // Portrait mode - show rotate message
    return (
      <div className="landscape-rotate-prompt">
        <button className="landscape-close" onClick={onClose}>
          ✕
        </button>
        <div className="rotate-message">
          <div className="rotate-icon">📱↪️</div>
          <h2 className="rotate-title">Rotate Your Phone</h2>
          <p className="rotate-subtitle">Turn to landscape mode to play</p>
          <p className="rotate-game-name">{game.title}</p>
        </div>
      </div>
    );
  }

  // Landscape mode - show game fullscreen
  return (
    <div className="landscape-fullscreen">
      <button className="landscape-close" onClick={onClose}>
        ✕
      </button>
      <iframe
        src={game.gameUrl}
        title={game.title}
        className="landscape-game-iframe"
        allow={`autoplay; fullscreen${game.permissions ? '; ' + game.permissions.join('; ') : ''}`}
      />
    </div>
  );
}

// Desktop only prompt - for games that don't work on mobile at all
function DesktopOnlyPrompt({ game, onClose }) {
  return (
    <div className="desktop-only-prompt">
      <button className="landscape-close" onClick={onClose}>
        ✕
      </button>
      <div className="desktop-only-message">
        <div className="desktop-only-icon">🖥️</div>
        <h2 className="desktop-only-title">Desktop Only</h2>
        <p className="desktop-only-subtitle">This game requires a desktop computer</p>
        <p className="rotate-game-name">{game.title}</p>
      </div>
    </div>
  );
}

// Full page game - no modal, just the game taking over the whole page
function FullPageGame({ game, onClose }) {
  return (
    <div className="fullpage-game">
      <Link to="/" className="fullpage-home-btn" onClick={onClose}>
        ← Home
      </Link>
      <iframe
        src={game.gameUrl}
        title={game.title}
        className="fullpage-iframe"
        allow={`autoplay; fullscreen${game.permissions ? '; ' + game.permissions.join('; ') : ''}`}
      />
    </div>
  );
}

// Standard modal for desktop viewing
function DesktopModal({ game, onClose, isMobileGame }) {
  // Use desktop-specific aspect ratio if provided, otherwise fall back to default
  const aspectRatio = game.aspectRatioDesktop || game.aspectRatio || "16 / 9";
  // Only apply portrait class if it's a mobile game WITHOUT a custom desktop aspect ratio
  const usePortrait = isMobileGame && !game.aspectRatioDesktop;
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-content ${usePortrait ? "modal-portrait" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h2 className="modal-title">{game.title}</h2>
        <div
          className="modal-game-wrapper"
          style={{ aspectRatio }}
        >
          <iframe
            src={game.gameUrl}
            title={game.title}
            className="game-iframe"
            allow={`autoplay; fullscreen${game.permissions ? '; ' + game.permissions.join('; ') : ''}`}
          />
        </div>
        
        {/* Auction Bar */}
        {game.tokenId && (
          <AuctionBar tokenId={game.tokenId} gameTitle={game.title} />
        )}
        
        <a
          href={game.gameUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="modal-fullscreen-link"
        >
          Open in new tab ↗
        </a>
      </div>
    </div>
  );
}

function GameModal() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const game = games.find((g) => g.slug === slug);
  const { trackPlay } = usePlayCounts();

  // Track play when game opens
  useEffect(() => {
    if (game) {
      trackPlay(game.slug);
    }
  }, [game?.slug]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === "Escape") {
        navigate("/");
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [navigate]);

  const handleClose = () => navigate("/");

  if (!game) {
    return (
      <div className="modal-overlay" onClick={handleClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close" onClick={handleClose}>
            ✕
          </button>
          <p className="modal-error">Game not found</p>
        </div>
      </div>
    );
  }

  // Full page mode - no modal, just the game
  if (game.fullPage) {
    return <FullPageGame game={game} onClose={handleClose} />;
  }

  // Redirect mode - just go to the game URL directly (works for all devices)
  if (game.redirect) {
    window.location.href = game.gameUrl;
    return null;
  }

  // Mobile-first game
  if (game.platform === "mobile") {
    if (isMobile) {
      // Mobile game on mobile device = fullscreen
      return <MobileFullscreen game={game} onClose={handleClose} />;
    } else {
      // Mobile game on desktop = portrait modal
      return (
        <DesktopModal game={game} onClose={handleClose} isMobileGame={true} />
      );
    }
  }

  // Desktop-first game
  if (game.platform === "desktop") {
    if (isMobile) {
      // Check for desktop-only mode (no mobile support at all)
      if (game.mobileMode === "desktop-only") {
        return <DesktopOnlyPrompt game={game} onClose={handleClose} />;
      }
      // Check for landscape mode (no virtual controller, requires phone rotation)
      if (game.mobileMode === "landscape") {
        return <LandscapeFullscreen game={game} onClose={handleClose} />;
      }
      // Desktop game on mobile = PICO-8 console
      return <PicoConsole game={game} onClose={handleClose} />;
    } else {
      // Desktop game on desktop = standard modal
      return (
        <DesktopModal game={game} onClose={handleClose} isMobileGame={false} />
      );
    }
  }

  // Fallback to standard modal
  return (
    <DesktopModal game={game} onClose={handleClose} isMobileGame={false} />
  );
}

function GameCard({ game }) {
  const { counts } = usePlayCounts();
  const playCount = counts[game.slug] || 0;

  return (
    <article className="game-card">
      <Link to={`/${game.slug}`} className="game-card-link">
        <div className="game-image-wrapper">
          <img
            src={game.image}
            alt={game.title}
            className="game-image"
            loading="lazy"
          />
          {playCount > 0 && (
            <div className="play-count">
              <span className="play-count-icon">🎮</span>
              <span className="play-count-number">{playCount.toLocaleString()}</span>
            </div>
          )}
        </div>
        <h2 className="game-title">{game.title}</h2>
      </Link>
      
      {/* Auction Bar */}
      {game.tokenId && (
        <AuctionBar tokenId={game.tokenId} gameTitle={game.title} />
      )}
    </article>
  );
}

function GamesGrid() {
  // Filter out hidden games from the grid (but they're still accessible via direct URL)
  const visibleGames = games.filter((game) => !game.hidden);
  
  return (
    <section className="games-grid">
      {visibleGames.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </section>
  );
}

// Social links configuration
const socialLinks = [
  { name: "Twitter", url: "https://x.com/songadaymann", icon: "𝕏" },
  { name: "YouTube", url: "https://youtube.com/jonathanmann", icon: "▶" },
  { name: "Instagram", url: "https://instagram.com/jonathanmann", icon: "📷" },
  { name: "Threads", url: "https://threads.net/jonathanmann", icon: "@" },
  { name: "Bluesky", url: "https://bsky.app/profile/songadaymann.bsky.social", icon: "🦋" },
  { name: "LinkedIn", url: "https://linkedin.com/in/jonathanmann", icon: "in" },
  { name: "Warpcast", url: "https://warpcast.com/jmann.eth", icon: "🟪" },
  { name: "GitHub", url: "https://github.com/songadaymann", icon: "⌨" },
  { name: "Email", url: "mailto:jonathan@jonathanmann.net", icon: "✉" },
];

function SocialLinks() {
  return (
    <div className="social-links">
      {socialLinks.map((link) => (
        <a
          key={link.name}
          href={link.url}
          target={link.url.startsWith("mailto:") ? undefined : "_blank"}
          rel="noopener noreferrer"
          className="social-link"
          title={link.name}
        >
          <span className="social-icon">{link.icon}</span>
        </a>
      ))}
    </div>
  );
}

// Turnstile site key - set in Vercel env or .env as VITE_TURNSTILE_SITE_KEY
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

// Guestbook component - retro style!
function Guestbook() {
  const [entries, setEntries] = useState([]);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileReady, setTurnstileReady] = useState(false);
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);

  // Load entries on mount
  useEffect(() => {
    fetch('/api/guestbook')
      .then(res => res.json())
      .then(data => {
        if (data.entries) {
          // Parse JSON strings if needed
          const parsed = data.entries.map(e => typeof e === 'string' ? JSON.parse(e) : e);
          setEntries(parsed);
        }
      })
      .catch(err => console.error('Failed to load guestbook:', err));
  }, []);

  // Load Turnstile script (only if site key is configured)
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    
    if (typeof window !== 'undefined' && !window.turnstile) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
      script.async = true;
      
      window.onTurnstileLoad = () => {
        setTurnstileReady(true);
      };
      
      document.head.appendChild(script);
    } else if (window.turnstile) {
      setTurnstileReady(true);
    }
  }, []);

  // Render Turnstile widget when ready
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileReady || !turnstileRef.current) return;
    if (turnstileWidgetId.current) return; // Already rendered
    
    turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(''),
      theme: 'dark',
    });
  }, [turnstileReady]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/guestbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message, turnstileToken }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to sign guestbook');
      }

      // Add new entry to the top
      setEntries(prev => [data.entry, ...prev]);
      setName('');
      setMessage('');
      setSuccess(true);
      
      // Reset Turnstile
      if (window.turnstile && turnstileWidgetId.current) {
        window.turnstile.reset(turnstileWidgetId.current);
      }
      setTurnstileToken('');

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <section className="guestbook">
      <h2 className="guestbook-title">📖 Guestbook</h2>
      <p className="guestbook-subtitle">Sign the guestbook, friend (or foe)!</p>

      {/* Sign form */}
      <form className="guestbook-form" onSubmit={handleSubmit}>
        <div className="guestbook-input-group">
          <label htmlFor="gb-name">Your Name</label>
          <input
            id="gb-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Anonymous Gamer"
            maxLength={50}
            required
          />
        </div>
        <div className="guestbook-input-group">
          <label htmlFor="gb-message">Message</label>
          <textarea
            id="gb-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Leave a message..."
            maxLength={500}
            rows={3}
            required
          />
        </div>
        
        {/* Turnstile widget - only shows if configured */}
        {TURNSTILE_SITE_KEY && <div ref={turnstileRef} className="guestbook-turnstile" />}

        {error && <p className="guestbook-error">{error}</p>}
        {success && <p className="guestbook-success">✨ Thanks for signing!</p>}

        <button 
          type="submit" 
          className="guestbook-submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Signing...' : '✍️ Sign Guestbook'}
        </button>
      </form>

      {/* Entries list */}
      <div className="guestbook-entries">
        {entries.length === 0 ? (
          <p className="guestbook-empty">Be the first to sign! 🎮</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="guestbook-entry">
              <div className="guestbook-entry-header">
                <span className="guestbook-entry-name">{entry.name}</span>
                <span className="guestbook-entry-date">{formatDate(entry.timestamp)}</span>
              </div>
              <p className="guestbook-entry-message">{entry.message}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// Guestbook Modal wrapper
function GuestbookModal({ isOpen, onClose }) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="guestbook-modal-overlay" onClick={onClose}>
      <div className="guestbook-modal-content" onClick={e => e.stopPropagation()}>
        <button className="guestbook-modal-close" onClick={onClose}>✕</button>
        <Guestbook />
      </div>
    </div>
  );
}

function AppContent() {
  const [guestbookOpen, setGuestbookOpen] = useState(false);

  return (
    <main className="page">
      <header className="header">
        <div className="wallet-connect">
          <ConnectButton />
        </div>
        <Link to="/" className="header-link">
          <h1 className="title">mann.cool</h1>
        </Link>
        <p className="subtitle">games by jonathan mann</p>
        <SocialLinks />
        <button 
          className="guestbook-trigger"
          onClick={() => setGuestbookOpen(true)}
        >
          📖 Guestbook
        </button>
      </header>

      <GamesGrid />

      <GuestbookModal isOpen={guestbookOpen} onClose={() => setGuestbookOpen(false)} />

      <Routes>
        <Route path="/:slug" element={<GameModal />} />
        <Route path="/" element={null} />
      </Routes>
    </main>
  );
}

export default function App() {
  const playCountsValue = usePlayCountsProvider();
  
  return (
    <PlayCountsContext.Provider value={playCountsValue}>
      <AppContent />
    </PlayCountsContext.Provider>
  );
}
