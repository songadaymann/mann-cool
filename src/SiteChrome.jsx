import catalog from "../games.json";

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

function SupportLinks({ tipUrl }) {
  return (
    <>
      <a className="support-donate" href="https://songaday.studio/?from=mann-cool#donate" target="_blank" rel="noreferrer">Support</a>
      {tipUrl && <a className="support-tip" href="/tip?from=mann-cool" target="_blank" rel="noreferrer">Tip Jar</a>}
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
      <nav className="site-nav" aria-label="Support and contact">
        {onOpenGuestbook
          ? <button className="nav-guestbook" type="button" onClick={onOpenGuestbook}>Guestbook</button>
          : <a className="nav-guestbook" href="/?guestbook=1">Guestbook</a>}
        <SupportLinks tipUrl={tipUrl} />
      </nav>
    </header>
  );
}

export function SiteFooter({ tipUrl }) {
  return (
    <footer className="site-footer">
      <p>Games by Jonathan Mann, maker of Song A Day. B-sides and experiments live in <a href="/lab">the lab</a>.</p>
      <nav aria-label="Support and contact">
        <SupportLinks tipUrl={tipUrl} />
      </nav>
    </footer>
  );
}
