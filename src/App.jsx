import { useEffect, useMemo, useRef, useState } from "react";
import catalog from "../games.json";

const publishedGames = catalog.games.filter((game) => game.status === "published");
const featuredGames = publishedGames
  .filter((game) => Number.isFinite(game.featuredRank))
  .sort((a, b) => a.featuredRank - b.featuredRank)
  .slice(0, 3);
const latestGame = publishedGames
  .slice()
  .sort((a, b) => b.catalogOrder - a.catalogOrder)[0];
const playCountsUrl = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "https://mann.cool/api/v1/plays"
  : "/api/v1/plays";
const guestbookUrl = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  ? "https://mann.cool/api/v1/guestbook"
  : "/api/v1/guestbook";

function initialTag() {
  const value = new URLSearchParams(window.location.search).get("tag");
  return catalog.tagVocabulary.includes(value) ? value : "All";
}

function canAnimatePreview() {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    && !navigator.connection?.saveData;
}

function GameCard({ game, featured = false, nsfwRevealed, onRevealNsfw, playCount }) {
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
            className={showPreview ? "game-card-preview" : "game-card-cover"}
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
          <span className="game-card-description">{game.description}</span>
          {Number.isFinite(playCount) && (
            <span className="game-card-plays">
              {playCount.toLocaleString()} {playCount === 1 ? "play" : "plays"}
            </span>
          )}
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

function TopSpotlights({ playCount }) {
  const [wampPreviewActive, setWampPreviewActive] = useState(false);
  const [wampPreviewFailed, setWampPreviewFailed] = useState(false);
  const [latestPreviewActive, setLatestPreviewActive] = useState(false);
  const [latestPreviewFailed, setLatestPreviewFailed] = useState(false);
  const showWampPreview = wampPreviewActive && !wampPreviewFailed;
  const showLatestPreview = latestPreviewActive && latestGame.hoverGif && !latestPreviewFailed;

  const startPreview = (setPreviewActive) => {
    if (canAnimatePreview()) setPreviewActive(true);
  };

  return (
    <section className="top-spotlights" aria-label="Game spotlights">
      <a
        className="spotlight-card wamp-spotlight"
        href="https://wamp.land/"
        target="_blank"
        rel="noreferrer"
        onMouseEnter={() => startPreview(setWampPreviewActive)}
        onMouseLeave={() => setWampPreviewActive(false)}
        onFocus={() => startPreview(setWampPreviewActive)}
        onBlur={() => setWampPreviewActive(false)}
      >
        <span className="wamp-spotlight-mark" aria-hidden="true">
          <img
            className={showWampPreview ? "wamp-preview" : "wamp-icon"}
            src={showWampPreview ? "/game-gifs/wamp.gif" : "/wamp/icon-512.png"}
            alt=""
            decoding="async"
            onError={() => setWampPreviewFailed(true)}
          />
          <span className="wamp-beta">BETA</span>
          <span className="wamp-color-bar" />
        </span>
        <span className="spotlight-copy">
          <span className="spotlight-eyebrow">Welcome to WAMP!</span>
          <strong>We All Make A Platformer</strong>
          <span className="spotlight-description">It's like if r/place and Mario Maker had a baby.</span>
          <span className="spotlight-action">Enter WAMP <span aria-hidden="true">↗</span></span>
        </span>
      </a>

      <a
        className="spotlight-card latest-spotlight"
        href={`/${latestGame.slug}/`}
        onMouseEnter={() => startPreview(setLatestPreviewActive)}
        onMouseLeave={() => setLatestPreviewActive(false)}
        onFocus={() => startPreview(setLatestPreviewActive)}
        onBlur={() => setLatestPreviewActive(false)}
      >
        <span className="latest-spotlight-art">
          <img
            src={showLatestPreview ? latestGame.hoverGif : latestGame.cover}
            alt=""
            decoding="async"
            onError={() => setLatestPreviewFailed(true)}
          />
        </span>
        <span className="spotlight-copy">
          <span className="spotlight-eyebrow">Latest game</span>
          <strong>{latestGame.title}</strong>
          <span className="spotlight-description">{latestGame.description}</span>
          {Number.isFinite(playCount) && (
            <span className="spotlight-plays">
              {playCount.toLocaleString()} {playCount === 1 ? "play" : "plays"}
            </span>
          )}
          <span className="spotlight-action">Play now <span aria-hidden="true">→</span></span>
        </span>
      </a>
    </section>
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

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);

  return new Promise((resolve, reject) => {
    let script = document.querySelector("#mann-cool-turnstile-script");
    if (!script) {
      script = document.createElement("script");
      script.id = "mann-cool-turnstile-script";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      document.head.append(script);
    }

    script.addEventListener("load", () => resolve(window.turnstile), { once: true });
    script.addEventListener("error", () => reject(new Error("Human verification could not load.")), { once: true });
  });
}

function GuestbookModal({ isOpen, onClose, turnstileSiteKey }) {
  const [entries, setEntries] = useState([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef(null);
  const turnstileWidgetId = useRef(null);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`${guestbookUrl}?slug=mann-cool&limit=50`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load the guestbook.");
        return response.json();
      })
      .then((data) => setEntries(data.entries || []))
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !turnstileSiteKey || !turnstileRef.current) return undefined;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !turnstile || !turnstileRef.current) return;
        turnstileWidgetId.current = turnstile.render(turnstileRef.current, {
          sitekey: turnstileSiteKey,
          theme: "light",
          size: "flexible",
          callback: (token) => {
            setTurnstileToken(token);
            setError("");
          },
          "expired-callback": () => setTurnstileToken(""),
          "error-callback": () => {
            setTurnstileToken("");
            setError("Human verification had trouble loading. Please try again.");
          },
        });
      })
      .catch((turnstileError) => setError(turnstileError.message));

    return () => {
      cancelled = true;
      if (turnstileWidgetId.current !== null && window.turnstile) {
        window.turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
      setTurnstileToken("");
    };
  }, [isOpen, turnstileSiteKey]);

  const submitEntry = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");
    setError("");

    try {
      const response = await fetch(`${guestbookUrl}?slug=mann-cool`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "mann-cool",
          name,
          message,
          turnstileToken,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not sign the guestbook.");
      setEntries((currentEntries) => [data.entry, ...currentEntries]);
      setMessage("");
      setStatus("Thanks for signing the guestbook!");
      setTurnstileToken("");
      if (turnstileWidgetId.current !== null && window.turnstile) {
        window.turnstile.reset(turnstileWidgetId.current);
      }
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
  };

  if (!isOpen) return null;

  return (
    <div className="guestbook-modal" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="guestbook-panel" role="dialog" aria-modal="true" aria-labelledby="guestbook-title">
        <header className="guestbook-header">
          <div>
            <span className="guestbook-eyebrow">You were here</span>
            <h2 id="guestbook-title">mann.cool guestbook</h2>
            <p>Sign the guestbook, just like the old days.</p>
          </div>
          <button ref={closeButtonRef} className="guestbook-close" type="button" onClick={onClose} aria-label="Close guestbook">
            ×
          </button>
        </header>

        <form className="guestbook-form" onSubmit={submitEntry}>
          <label>
            Your name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={50}
              autoComplete="nickname"
              placeholder="Anonymous Gamer"
              required
            />
          </label>
          <label>
            Message
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Leave a message..."
              required
            />
          </label>
          <div className="guestbook-form-footer">
            <span className="guestbook-counter">{message.length}/500</span>
            <button type="submit" disabled={submitting || !turnstileToken}>
              {submitting ? "Signing..." : "Sign guestbook"}
            </button>
          </div>
          {turnstileSiteKey
            ? <div ref={turnstileRef} className="guestbook-turnstile" />
            : <p className="guestbook-note">Human verification is unavailable right now.</p>}
          {error && <p className="guestbook-error" role="alert">{error}</p>}
          {status && <p className="guestbook-success" role="status">{status}</p>}
        </form>

        <div className="guestbook-entries" aria-live="polite">
          {loading && <p className="guestbook-empty">Loading signatures…</p>}
          {!loading && entries.length === 0 && !error && (
            <p className="guestbook-empty">Be the first to sign.</p>
          )}
          {!loading && entries.map((entry) => (
            <article className="guestbook-entry" key={entry.id}>
              <header>
                <strong>{entry.name}</strong>
                <time dateTime={entry.timestamp}>{formatDate(entry.timestamp)}</time>
              </header>
              <p>{entry.message}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
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
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("");
  const [guestbookOpen, setGuestbookOpen] = useState(false);
  const [playCounts, setPlayCounts] = useState({});
  const [nsfwRevealed, setNsfwRevealed] = useState(
    () => window.localStorage.getItem("mann.cool:nsfw-revealed") === "true",
  );

  useEffect(() => {
    fetch("/platform/config.json")
      .then((response) => response.json())
      .then((config) => {
        setTipUrl(config.tipUrl || "");
        setTurnstileSiteKey(config.turnstileSiteKey || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(playCountsUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load play counts");
        return response.json();
      })
      .then((data) => setPlayCounts(data.counts || {}))
      .catch(() => {});
    return () => controller.abort();
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
          <button className="nav-guestbook" type="button" onClick={() => setGuestbookOpen(true)}>
            Guestbook
          </button>
          <SupportLinks tipUrl={tipUrl} />
        </nav>
      </header>

      <main>
        <TopSpotlights playCount={playCounts[latestGame.slug]} />

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
                playCount={playCounts[game.slug]}
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
                playCount={playCounts[game.slug]}
              />
            ))}
          </div>
          {!games.length && <p className="empty-state">No published games use this tag yet.</p>}
        </section>
      </main>

      <Footer tipUrl={tipUrl} />
      <GuestbookModal
        isOpen={guestbookOpen}
        onClose={() => setGuestbookOpen(false)}
        turnstileSiteKey={turnstileSiteKey}
      />
    </div>
  );
}
