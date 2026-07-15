import { useEffect, useMemo, useState } from "react";
import catalog from "../games.json";

const publishedGames = catalog.games.filter((game) => game.status === "published");
const featuredGames = publishedGames
  .filter((game) => Number.isFinite(game.featuredRank))
  .sort((a, b) => a.featuredRank - b.featuredRank)
  .slice(0, 3);

function initialTag() {
  const value = new URLSearchParams(window.location.search).get("tag");
  return catalog.tagVocabulary.includes(value) ? value : "All";
}

function canAnimatePreview() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    && !navigator.connection?.saveData;
}

function GameCard({ game, featured = false, nsfwRevealed, onRevealNsfw }) {
  const [previewActive, setPreviewActive] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const isNsfw = game.tags.includes("NSFW");
  const artworkHidden = isNsfw && !nsfwRevealed;
  const showPreview = previewActive && game.hoverGif && !previewFailed && !artworkHidden;

  const startPreview = () => {
    if (canAnimatePreview() && game.hoverGif) setPreviewActive(true);
  };

  return (
    <article className={`game-card${featured ? " game-card-featured" : ""}${artworkHidden ? " game-card-nsfw" : ""}`}>
      <a
        className="game-card-link"
        href={`/${game.slug}/`}
        onMouseEnter={startPreview}
        onMouseLeave={() => setPreviewActive(false)}
        onFocus={startPreview}
        onBlur={() => setPreviewActive(false)}
      >
        <span className="game-card-art">
          <img
            src={showPreview ? game.hoverGif : game.cover}
            alt=""
            loading={featured ? "eager" : "lazy"}
            decoding="async"
            onError={() => setPreviewFailed(true)}
          />
          {artworkHidden && <span className="nsfw-label">NSFW artwork</span>}
        </span>
        <span className="game-card-copy">
          <strong>{game.title}</strong>
          <span>{game.description}</span>
        </span>
      </a>
      {artworkHidden && (
        <button className="nsfw-reveal" type="button" onClick={onRevealNsfw}>
          Reveal artwork
        </button>
      )}
    </article>
  );
}

function SupportLinks({ tipUrl }) {
  return (
    <>
      <a href="https://www.patreon.com/jonathanmann" target="_blank" rel="noreferrer">Patreon</a>
      {tipUrl && <a href={tipUrl} target="_blank" rel="noreferrer">Tip Jar</a>}
      <a href="https://x.com/songadaymann" target="_blank" rel="noreferrer">X</a>
      <a href="https://instagram.com/jonathanmann" target="_blank" rel="noreferrer">Instagram</a>
      <a href="mailto:jonathan@jonathanmann.net">Contact</a>
    </>
  );
}

function Footer({ tipUrl }) {
  return (
    <footer className="site-footer">
      <p>Games by Jonathan Mann, maker of Song A Day.</p>
      <nav aria-label="Support and contact">
        <SupportLinks tipUrl={tipUrl} />
      </nav>
    </footer>
  );
}

export default function App() {
  const [activeTag, setActiveTag] = useState(initialTag);
  const [tipUrl, setTipUrl] = useState("");
  const [nsfwRevealed, setNsfwRevealed] = useState(
    () => window.localStorage.getItem("mann.cool:nsfw-revealed") === "true",
  );

  useEffect(() => {
    fetch("/platform/config.json")
      .then((response) => response.json())
      .then((config) => setTipUrl(config.tipUrl || ""))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onPopState = () => setActiveTag(initialTag());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const games = useMemo(() => publishedGames
    .filter((game) => activeTag === "All" || game.tags.includes(activeTag))
    .sort((a, b) => b.catalogOrder - a.catalogOrder), [activeTag]);

  const chooseTag = (tag) => {
    const url = new URL(window.location.href);
    if (tag === "All") url.searchParams.delete("tag");
    else url.searchParams.set("tag", tag);
    window.history.pushState({}, "", url);
    setActiveTag(tag);
  };

  const revealNsfw = () => {
    window.localStorage.setItem("mann.cool:nsfw-revealed", "true");
    setNsfwRevealed(true);
  };

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="site-identity">
          <a className="wordmark" href="/">mann.cool</a>
          <p>games by Jonathan Mann, maker of Song A Day</p>
        </div>
        <nav className="site-nav" aria-label="Support and contact">
          <SupportLinks tipUrl={tipUrl} />
        </nav>
      </header>

      <main>
        <section className="featured-section" aria-labelledby="featured-title">
          <div className="section-heading">
            <h1 id="featured-title">Featured games</h1>
          </div>
          <div className="featured-grid">
            {featuredGames.map((game) => (
              <GameCard
                key={game.slug}
                game={game}
                featured
                nsfwRevealed={nsfwRevealed}
                onRevealNsfw={revealNsfw}
              />
            ))}
          </div>
        </section>

        <section className="catalog-section" aria-labelledby="all-games-title">
          <div className="section-heading catalog-heading">
            <div>
              <h2 id="all-games-title">All games</h2>
              <p>{games.length} {games.length === 1 ? "game" : "games"}</p>
            </div>
            <div className="tag-filter" aria-label="Filter games by tag">
              {["All", ...catalog.tagVocabulary].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={activeTag === tag ? "active" : ""}
                  aria-pressed={activeTag === tag}
                  onClick={() => chooseTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
          <div className="games-grid">
            {games.map((game) => (
              <GameCard
                key={game.slug}
                game={game}
                nsfwRevealed={nsfwRevealed}
                onRevealNsfw={revealNsfw}
              />
            ))}
          </div>
          {!games.length && <p className="empty-state">No published games use this tag yet.</p>}
        </section>
      </main>

      <Footer tipUrl={tipUrl} />
    </div>
  );
}
