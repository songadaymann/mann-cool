import { Routes, Route, Link, useParams, useNavigate } from "react-router-dom";
import { useEffect } from "react";

const games = [
  {
    id: 1,
    slug: "coldplay-canoodle",
    title: "Coldplay Canoodle",
    image: "/nes-game-images/coldplay-canoodle.png",
    gameUrl: "https://coldplay-canoodle.vercel.app", // Update with actual URL
  },
  {
    id: 2,
    slug: "crypto-tax-nightmare",
    title: "Crypto Tax Nightmare",
    image: "/nes-game-images/crypto-tax-nightmare.png",
    gameUrl: "https://game.songaday.world/", // Update with actual URL
  },
  {
    id: 3,
    slug: "windows-didnt-load",
    title: "Windows Didn't Load Correctly",
    image: "/nes-game-images/windows-didn't-load.png",
    gameUrl: "https://gamejew.itch.io/windowshttps://windows-git-main-jonathan-manns-projects-fcbebd01.vercel.app/", // Update with actual URL
  },
  {
    id: 4,
    slug: "oil",
    title: "It's About Oil",
    image: "/nes-game-images/its-about-oil-pre.png",
    gameUrl: "https://oil-ruddy.vercel.app",
  },
];

function GameModal() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const game = games.find((g) => g.slug === slug);

  useEffect(() => {
    // Prevent body scroll when modal is open
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

  if (!game) {
    return (
      <div className="modal-overlay" onClick={() => navigate("/")}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close" onClick={() => navigate("/")}>
            ✕
          </button>
          <p className="modal-error">Game not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={() => navigate("/")}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={() => navigate("/")}>
          ✕
        </button>
        <h2 className="modal-title">{game.title}</h2>
        <div className="modal-game-wrapper">
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
