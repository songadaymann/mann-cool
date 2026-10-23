import { useEffect, useState } from "react";
import catalog from "../games.json";
import { visibleLabGames } from "./lib/lab.js";
import { applyWalletGate } from "./lib/wallet-gate.js";

const UNIVERSE_BAR_SRC = "https://songaday.studio/bar/v1/bar.js";

// The Song A Day universe bar from songaday.studio, on the homepage and the lab only (never over a
// game). The placeholder holds its 36px so nothing moves when the bar draws into it. The script is
// added once the placeholder is on the page, so the bar fills it in rather than adding its own.
export function UniverseBar() {
  useEffect(() => {
    if (document.querySelector(`script[src="${UNIVERSE_BAR_SRC}"]`)) return;
    const script = document.createElement("script");
    script.type = "module";
    script.src = UNIVERSE_BAR_SRC;
    script.dataset.here = "play";
    document.head.append(script);
  }, []);
  return <songaday-bar data-here="play" />;
}

// The lab games this visitor can see. Until the wallet gate answers, that's only the ones open to
// everyone, and waiting is true.
export function useLabGames() {
  const [hasWallet, setHasWallet] = useState(null);
  useEffect(() => {
    let live = true;
    applyWalletGate()
      .then((result) => { if (live) setHasWallet(result.hasWallet); })
      .catch(() => { if (live) setHasWallet(false); });
    return () => { live = false; };
  }, []);
  return { games: visibleLabGames(catalog.games, hasWallet), waiting: hasWallet === null };
}

// Linked Song A Day songs open on YouTube; songaday.world's song pages lead with bids and sales.
function songLinks(game) {
  return (game.songs || [])
    .filter((number) => catalog.songVideos?.[number])
    .map((number) => ({ number, url: `https://www.youtube.com/watch?v=${catalog.songVideos[number]}` }));
}

export function GameLinks({ game }) {
  return (
    <>
      {songLinks(game).map((song) => (
        <a key={song.number} href={song.url} target="_blank" rel="noopener noreferrer">
          Hear the song: Song A Day #{song.number}
        </a>
      ))}
      {game.sourceUrl && <a href={game.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a>}
    </>
  );
}

// The Tip Jar link from /platform/config.json, which goes straight to Song A Day's Zeffy form.
export function useTipUrl() {
  const [tipUrl, setTipUrl] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/platform/config.json")
      .then((response) => response.json())
      .then((config) => { if (live) setTipUrl(config.tipUrl || ""); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return tipUrl;
}

// Until the config answers, /tip redirects to the same Zeffy form, so the link is never missing.
export function TipJarLink({ tipUrl, className }) {
  return (
    <a className={className} href={tipUrl || "/tip?from=mann-cool"} target="_blank" rel="noopener noreferrer">Tip Jar</a>
  );
}

function SiteLinks({ tipUrl }) {
  return (
    <>
      <TipJarLink className="support-tip" tipUrl={tipUrl} />
      <a className="support-x" href="https://x.com/songadaymann" target="_blank" rel="noreferrer">X</a>
      <a className="support-instagram" href="https://instagram.com/jonathanmann" target="_blank" rel="noreferrer">Instagram</a>
      <a href="mailto:jonathan@jonathanmann.net">Contact</a>
    </>
  );
}

// Off the homepage, the guestbook link goes back there and opens it.
export function SiteHeader({ tipUrl, onOpenGuestbook }) {
  return (
    <header className="site-header">
      <div className="site-identity">
        <a className="wordmark" href="/">mann.cool</a>
        <p>games by Jonathan Mann, maker of Song A Day</p>
      </div>
      <nav className="site-nav" aria-label="Tip Jar and contact">
        {onOpenGuestbook
          ? <button className="nav-guestbook" type="button" onClick={onOpenGuestbook}>Guestbook</button>
          : <a className="nav-guestbook" href="/?guestbook=1">Guestbook</a>}
        <SiteLinks tipUrl={tipUrl} />
      </nav>
    </header>
  );
}

// The lab link shows only when this visitor can see something there.
export function SiteFooter({ tipUrl, showLab }) {
  return (
    <footer className="site-footer">
      <p>
        Games by Jonathan Mann, maker of Song A Day.
        {showLab && <> B-sides and experiments live in <a href="/lab">the lab</a>.</>}
      </p>
      <nav aria-label="Tip Jar and contact">
        <SiteLinks tipUrl={tipUrl} />
      </nav>
    </footer>
  );
}
