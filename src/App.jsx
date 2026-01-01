import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Routes, Route, Link, useParams, useNavigate } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { AuctionBar } from "./components/auction/AuctionBar";

const games = [
  {
    id: 1,
    tokenId: 1, // NFT token ID for auction
    slug: "coldplay-canoodle",
    title: "Coldplay Canoodle",
    image: "/nes-game-images/coldplay-canoodle.png",
    gameUrl: "https://coldplay-canoodle.vercel.app",
    platform: "desktop", // "desktop" or "mobile"
    aspectRatio: "4 / 3", // width / height - common: "16 / 9", "4 / 3", "1 / 1"
    controls: {
      dpad: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" },
      actions: [
        { key: "z", label: "A" },
        { key: "x", label: "B" },
      ],
    },
  },
  {
    id: 2,
    tokenId: 2, // NFT token ID for auction
    slug: "ctn",
    title: "Crypto Tax Nightmare",
    image: "/nes-game-images/crypto-tax-nightmare.png",
    gameUrl: "https://game.songaday.world/",
    platform: "desktop",
    aspectRatio: "16 / 9",
    controls: {
      dpad: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" },
      actions: [
        { key: "ArrowUp", label: "JUMP" },
        { key: "click", label: "ATTACK", isClick: true },
      ],
    },
  },
  {
    id: 3,
    tokenId: null, // Not minted yet
    slug: "windows",
    title: "Windows Didn't Load Correctly",
    image: "/nes-game-images/windows-didn't-load.png",
    gameUrl: "https://windows-ruddy.vercel.app",
    platform: "desktop",
    aspectRatio: "3 / 2",
    controls: {
      dpad: { up: "w", down: "s", left: "a", right: "d" },
      hasLookStick: true, // 3D game with camera controls
      actions: [
        { key: " ", label: "JUMP" },
        { key: "click", label: "ATTACK", isClick: true },
        { key: "f", label: "DASH" },
        { key: "q", label: "CROUCH" },
        { key: "e", label: "POUND" },
        { keys: ["Tab", "g"], label: "TAB" }, // Skip tutorial, general action (sends both Tab and G)
      ],
    },
  },
  {
    id: 4,
    tokenId: null, // Not minted yet
    slug: "tallgrass",
    title: "Tall Grass",
    image: "/nes-game-images/tall-grass.png",
    gameUrl: "https://tallgrass-game.vercel.app",
    platform: "desktop",
    aspectRatio: "16 / 9",
    controls: {
      dpad: { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" },
      hasLookStick: true, // 3D game with camera controls
      actions: [
        { key: "f", label: "COLLECT" },
        { key: "click", label: "SWORD", isClick: true },
        { key: "i", label: "INV" },
        { key: "m", label: "MAP" },
        { key: "Shift", label: "RUN" },
      ],
    },
  },
];

// Hook to detect mobile
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768 || "ontouchstart" in window);
    };
    checkMobile();
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
  const sendKey = (key, type) => {
    const iframe = document.querySelector(".pico-game-iframe");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: "keyEvent", key, eventType: type },
        "*"
      );
    }
  };

  const sendClick = (type) => {
    const iframe = document.querySelector(".pico-game-iframe");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: "clickEvent", eventType: type },
        "*"
      );
    }
  };

  const sendMouseMove = (deltaX, deltaY) => {
    const iframe = document.querySelector(".pico-game-iframe");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
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

  const dpad = game.controls?.dpad || {};
  const actions = game.controls?.actions || [];
  const hasLookStick = game.controls?.hasLookStick || false;
  const hasMany = actions.length > 2 || hasLookStick;

  return (
    <div className="pico-fullscreen">
      <button className="pico-close" onClick={onClose}>
        ✕
      </button>

      <div className={`pico-console ${hasMany ? "pico-console-expanded" : ""}`}>
        <div className="pico-bezel">
          <div className="pico-screen-area">
            <div className="pico-screen-label">{game.title}</div>
            <div
              className="pico-screen"
              style={{ aspectRatio: game.aspectRatio || "1 / 1" }}
            >
              <iframe
                src={game.gameUrl}
                title={game.title}
                className="pico-game-iframe"
                allow="autoplay; fullscreen"
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
            <div className={`pico-action-buttons ${hasMany && !hasLookStick ? "pico-action-grid" : ""}`}>
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
        allow="autoplay; fullscreen"
      />
    </div>
  );
}

// Standard modal for desktop viewing
function DesktopModal({ game, onClose, isMobileGame }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal-content ${isMobileGame ? "modal-portrait" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
        <h2 className="modal-title">{game.title}</h2>
        <div
          className="modal-game-wrapper"
          style={{ aspectRatio: game.aspectRatio || "16 / 9" }}
        >
          <iframe
            src={game.gameUrl}
            title={game.title}
            className="game-iframe"
            allow="autoplay; fullscreen"
          />
        </div>
        
        {/* Auction Bar - shows if game has a tokenId */}
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
        </div>
        <h2 className="game-title">{game.title}</h2>
      </Link>
      
      {/* Auction Bar - shows beneath each game card if it has a tokenId */}
      {game.tokenId && (
        <AuctionBar tokenId={game.tokenId} gameTitle={game.title} />
      )}
    </article>
  );
}

function GamesGrid() {
  return (
    <section className="games-grid">
      {games.map((game) => (
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

export default function App() {
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
      </header>

      <GamesGrid />

      <Routes>
        <Route path="/:slug" element={<GameModal />} />
        <Route path="/" element={null} />
      </Routes>
    </main>
  );
}
