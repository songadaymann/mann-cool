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
        { key: "x", label: "B" },
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
      actions: [
        { key: " ", label: "JUMP" },
        { key: "click", label: "ATTACK", isClick: true },
        { key: "f", label: "DASH" },
        { key: "e", label: "POUND" },
        { key: "q", label: "CROUCH" },
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

// PICO-8 style console for desktop games on mobile
function PicoConsole({ game, onClose }) {
  const sendKey = (key, type) => {
    // Try to send key event via postMessage
    // Games need to listen for this - see docs
    const iframe = document.querySelector(".pico-game-iframe");
    console.log("🎮 Sending key:", key, type, "iframe found:", !!iframe);
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: "keyEvent", key, eventType: type },
        "*"
      );
    }
  };

  const sendClick = (type) => {
    // Send mouse click event for games that use click
    const iframe = document.querySelector(".pico-game-iframe");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: "clickEvent", eventType: type },
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
  const hasMany = actions.length > 2;

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

          <div className={`pico-controls ${hasMany ? "pico-controls-expanded" : ""}`}>
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

            {/* Action Buttons - dynamically rendered */}
            <div className={`pico-action-buttons ${hasMany ? "pico-action-grid" : ""}`}>
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
