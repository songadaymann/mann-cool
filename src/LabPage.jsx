import { useEffect } from "react";
import { GameLinks, SiteFooter, SiteHeader, UniverseBar, useLabGames, useTipUrl } from "./SiteChrome.jsx";

function LabCard({ game }) {
  // Lab games usually stay on their own host; the card says where it goes.
  const host = game.url ? new URL(game.url).host : null;
  return (
    <article className="game-card lab-card" data-crypto={game.crypto ? "" : undefined}>
      <a
        className="game-card-link"
        href={game.url || `/${game.slug}/`}
        {...(host && { target: "_blank", rel: "noopener noreferrer" })}
      >
        <span className="game-card-art lab-card-art">
          {game.cover
            ? <img className="game-card-cover" src={game.cover} alt="" loading="lazy" decoding="async" />
            : <span className="lab-card-placeholder" aria-hidden="true">{game.title}</span>}
        </span>
        <span className="game-card-copy">
          <strong>{game.title}</strong>
          <span className="game-card-description">{game.description}</span>
          {host && <span className="lab-card-host">Plays at {host} <span aria-hidden="true">↗</span></span>}
        </span>
      </a>
      {(game.songs?.length > 0 || game.sourceUrl) && (
        <div className="game-card-community">
          <GameLinks game={game} />
        </div>
      )}
    </article>
  );
}

export default function LabPage() {
  const tipUrl = useTipUrl();
  // Crypto-only experiments show only in browsers that have a wallet installed.
  const { games, waiting } = useLabGames();

  useEffect(() => {
    document.title = "The lab | mann.cool";
  }, []);

  // Nothing links here unless this visitor can see a lab game. Anyone who comes straight here
  // when there's nothing for them gets one line, once the wallet gate has answered.
  return (
    <>
      <UniverseBar />
      <div className="site-shell">
        <SiteHeader tipUrl={tipUrl} />

        {/* A fixed floor, so the footer doesn't jump when the wallet check answers. */}
        <main aria-busy={waiting && !games.length ? true : undefined} style={{ minHeight: "60vh" }}>
          {games.length > 0 && (
            <section aria-labelledby="lab-title">
              <div className="section-heading">
                <div>
                  <h1 id="lab-title">The lab</h1>
                  <p className="lab-intro">B-sides, experiments and games that didn't quite work out. Play at your own risk.</p>
                </div>
                <a className="lab-back" href="/">All games <span aria-hidden="true">→</span></a>
              </div>
              <div className="lab-grid">
                {games.map((game) => <LabCard key={game.slug} game={game} />)}
              </div>
            </section>
          )}
          {!games.length && !waiting && <p className="empty-state">Nothing here yet.</p>}
        </main>

        <SiteFooter tipUrl={tipUrl} showLab={games.length > 0} />
      </div>
    </>
  );
}
