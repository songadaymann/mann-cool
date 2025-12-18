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
      up: "ArrowUp",
      down: "ArrowDown",
      left: "ArrowLeft",
      right: "ArrowRight",
      a: "z",
      b: "x",
    },
  },
  {
    id: 2,
    slug: "crypto-tax-nightmare",
    title: "Crypto Tax Nightmare",
    image: "/nes-game-images/crypto-tax-nightmare.png",
    gameUrl: "https://game.songaday.world/",
    platform: "desktop",
    aspectRatio: "16 / 9",
    controls: {
      up: "ArrowUp",
      down: "ArrowDown",
      left: "ArrowLeft",
      right: "ArrowRight",
      a: "z",
      b: "x",
    },
  },
  {
    id: 3,
    slug: "windows-didnt-load",
    title: "Windows Didn't Load Correctly",
    image: "/nes-game-images/windows-didn't-load.png",
    gameUrl:
      "https://windows-git-main-jonathan-manns-projects-fcbebd01.vercel.app/",
    platform: "desktop",
    aspectRatio: "4 / 3",
    controls: {
      up: "ArrowUp",
      down: "ArrowDown",
      left: "ArrowLeft",
      right: "ArrowRight",
      a: "z",
      b: "x",
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
  const iframeRef = useState(null);

  const sendKey = (key, type) => {
    // Try to send key event via postMessage
    // Games need to listen for this - see docs
    const iframe = document.querySelector(".pico-game-iframe");
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: "keyEvent", key, eventType: type },
        "*"
      );
    }
  };

  const handleButtonDown = (key) => sendKey(key, "keydown");
  const handleButtonUp = (key) => sendKey(key, "keyup");

  return (
    <div className="pico-fullscreen">
      <button className="pico-close" onClick={onClose}>
        ✕
      </button>

      <div className="pico-console">
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
                allow="autoplay; fullscreen"
              />
            </div>
          </div>

          <div className="pico-controls">
            {/* D-Pad */}
            <div className="pico-dpad">
              <button
                className="pico-btn pico-up"
                onTouchStart={() => handleButtonDown(game.controls?.up)}
                onTouchEnd={() => handleButtonUp(game.controls?.up)}
                onMouseDown={() => handleButtonDown(game.controls?.up)}
                onMouseUp={() => handleButtonUp(game.controls?.up)}
              >
                ▲
              </button>
              <button
                className="pico-btn pico-left"
                onTouchStart={() => handleButtonDown(game.controls?.left)}
                onTouchEnd={() => handleButtonUp(game.controls?.left)}
                onMouseDown={() => handleButtonDown(game.controls?.left)}
                onMouseUp={() => handleButtonUp(game.controls?.left)}
              >
                ◀
              </button>
              <div className="pico-dpad-center"></div>
              <button
                className="pico-btn pico-right"
                onTouchStart={() => handleButtonDown(game.controls?.right)}
                onTouchEnd={() => handleButtonUp(game.controls?.right)}
                onMouseDown={() => handleButtonDown(game.controls?.right)}
                onMouseUp={() => handleButtonUp(game.controls?.right)}
              >
                ▶
              </button>
              <button
                className="pico-btn pico-down"
                onTouchStart={() => handleButtonDown(game.controls?.down)}
                onTouchEnd={() => handleButtonUp(game.controls?.down)}
                onMouseDown={() => handleButtonDown(game.controls?.down)}
                onMouseUp={() => handleButtonUp(game.controls?.down)}
              >
                ▼
              </button>
            </div>

            {/* Action Buttons */}
            <div className="pico-action-buttons">
              <button
                className="pico-btn pico-btn-b"
                onTouchStart={() => handleButtonDown(game.controls?.b)}
                onTouchEnd={() => handleButtonUp(game.controls?.b)}
                onMouseDown={() => handleButtonDown(game.controls?.b)}
                onMouseUp={() => handleButtonUp(game.controls?.b)}
              >
                B
              </button>
              <button
                className="pico-btn pico-btn-a"
                onTouchStart={() => handleButtonDown(game.controls?.a)}
                onTouchEnd={() => handleButtonUp(game.controls?.a)}
                onMouseDown={() => handleButtonDown(game.controls?.a)}
                onMouseUp={() => handleButtonUp(game.controls?.a)}
              >
                A
              </button>
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
        <Link to="/" className="header-link">
          <h1 className="title">mann.cool</h1>
        </Link>
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
