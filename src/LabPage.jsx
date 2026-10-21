import { useEffect, useState } from "react";
import catalog from "../games.json";
import { GameLinks, SiteFooter, SiteHeader } from "./SiteChrome.jsx";
import { applyWalletGate } from "./lib/wallet-gate.js";

const labGames = catalog.games
  .filter((game) => game.status === "lab")
  .sort((a, b) => b.catalogOrder - a.catalogOrder);

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
  const [tipUrl, setTipUrl] = useState("");
  const [hasWallet, setHasWallet] = useState(false);

  useEffect(() => {
    document.title = "The lab | mann.cool";
  }, []);

  useEffect(() => {
    fetch("/platform/config.json")
      .then((response) => response.json())
      .then((config) => setTipUrl(config.tipUrl || ""))
      .catch(() => {});
  }, []);

  // Crypto-only experiments show only in browsers that have a wallet installed.
  useEffect(() => {
    applyWalletGate()
      .then((result) => setHasWallet(result.hasWallet))
      .catch(() => {});
  }, []);

  const games = labGames.filter((game) => !game.crypto || hasWallet);

  return (
    <div className="site-shell">
      <SiteHeader tipUrl={tipUrl} />

      <main>
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
          {!games.length && <p className="empty-state">Nothing in the lab right now.</p>}
        </section>
      </main>

      <SiteFooter tipUrl={tipUrl} />
    </div>
  );
}
