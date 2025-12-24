import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Routes, Route, Link, useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

const games = [
  {
    id: 1,
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
        { key: "q", label: "CROUCH" },
        { key: "e", label: "POUND" },
        { key: "f", label: "DASH" },
      ],
    },
  },
  {
    id: 4,
    slug: "oil",
    title: "It's About Oil",
    image: "/nes-game-images/its-about-oil-pre.png",
    gameUrl: "https://oil-ruddy.vercel.app",
    platform: "mobile",
    aspectRatio: "9 / 16", // portrait for mobile games
    controls: null, // mobile games don't need virtual controls
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
  const stickRef = React.useRef(null);
  const centerRef = React.useRef({ x: 0, y: 0 });
  const animationRef = React.useRef(null);

  const handleStart = (e) => {
    e.preventDefault();
    const rect = stickRef.current.getBoundingClientRect();
    centerRef.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    setIsActive(true);
    
    // Start continuous movement updates
    const sendMovement = () => {
      if (position.x !== 0 || position.y !== 0) {
        onMove(position.x * 8, position.y * 8); // Scale for sensitivity
      }
      animationRef.current = requestAnimationFrame(sendMovement);
    };
    animationRef.current = requestAnimationFrame(sendMovement);
  };

  const handleMove = (e) => {
    if (!isActive) return;
    e.preventDefault();
    
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
    
    setPosition({ x: clampedX, y: clampedY });
  };

  const handleEnd = () => {
    setIsActive(false);
    setPosition({ x: 0, y: 0 });
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
function PicoConsole({ game, onClose }) {
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

  const handleButtonDown = (key, isClick) => {
    if (isClick) {
      sendClick("mousedown");
    } else {
      sendKey(key, "keydown");
    }
  };

  const handleButtonUp = (key, isClick) => {
    if (isClick) {
      sendClick("mouseup");
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

            {/* Look Stick for 3D games */}
            {hasLookStick && (
              <VirtualJoystick
                onMove={(dx, dy) => sendMouseMove(dx, dy)}
                label="LOOK"
              />
            )}

            {/* Action Buttons - dynamically rendered */}
            <div className={`pico-action-buttons ${hasMany && !hasLookStick ? "pico-action-grid" : ""}`}>
              {actions.map((action, index) => (
                <button
                  key={index}
                  className={`pico-btn pico-btn-action pico-btn-${index}`}
                  onTouchStart={() => handleButtonDown(action.key, action.isClick)}
                  onTouchEnd={() => handleButtonUp(action.key, action.isClick)}
                  onMouseDown={() => handleButtonDown(action.key, action.isClick)}
                  onMouseUp={() => handleButtonUp(action.key, action.isClick)}
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

function GamesGrid() {
  return (
    <section className="games-grid">
      {games.map((game) => (
        <Link to={`/${game.slug}`} key={game.id} className="game-card-link">
          <article className="game-card">
            <div className="game-image-wrapper">
              <img
                src={game.image}
                alt={game.title}
                className="game-image"
                loading="lazy"
              />
            </div>
            <h2 className="game-title">{game.title}</h2>
          </article>
        </Link>
      ))}
    </section>
  );
}

export default function App() {
  return (
    <main className="page">
      <header className="header">
        <div className="header-top">
          <Link to="/" className="header-link">
            <h1 className="title">mann.cool</h1>
          </Link>
          <div className="wallet-connect">
            <ConnectButton />
          </div>
        </div>
        <p className="subtitle">games by jonathan mann</p>
      </header>

      <GamesGrid />

      <Routes>
        <Route path="/:slug" element={<GameModal />} />
        <Route path="/" element={null} />
      </Routes>
    </main>
  );
}
