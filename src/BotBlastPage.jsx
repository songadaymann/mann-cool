import { useEffect } from "react";
import "./botblast.css";

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/bot-blast/bkfmmmpoidhhdbgeacfjcbmgjlcckjjj";
const PRIVACY_URL = "https://twitter-bot-destroyer-registry.novox-robot.workers.dev/privacy";
const SUPPORT_URL = "https://twitter-bot-destroyer-registry.novox-robot.workers.dev/support";

function InstallControl() {
  if (CHROME_STORE_URL) {
    return (
      <a className="botblast-install" href={CHROME_STORE_URL} target="_blank" rel="noreferrer">
        Install from Chrome Web Store <span aria-hidden="true">↗</span>
      </a>
    );
  }

  return (
    <span className="botblast-install botblast-install-pending" aria-disabled="true">
      Chrome Web Store — coming soon
    </span>
  );
}

export default function BotBlastPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Bot Blast — Clean up your timeline";
    document.body.classList.add("botblast-active");

    let description = document.querySelector('meta[name="description"]');
    const createdDescription = !description;
    const previousDescription = description?.getAttribute("content") ?? "";
    if (!description) {
      description = document.createElement("meta");
      description.setAttribute("name", "description");
      document.head.append(description);
    }
    description.setAttribute(
      "content",
      "Bot Blast turns suspicious X replies into a fast three-wave arcade fight, then hides the selected handle locally.",
    );

    return () => {
      document.title = previousTitle;
      document.body.classList.remove("botblast-active");
      if (createdDescription) description.remove();
      else description.setAttribute("content", previousDescription);
    };
  }, []);

  return (
    <div className="botblast-page">
      <header className="botblast-header">
        <a className="botblast-mann" href="/" aria-label="mann.cool home">mann.cool</a>
        <nav aria-label="Bot Blast information">
          <a href={PRIVACY_URL}>Privacy</a>
          <a href={SUPPORT_URL}>Support</a>
        </nav>
      </header>

      <main className="botblast-main">
        <h1 className="botblast-visually-hidden">Bot Blast</h1>
        <img
          className="botblast-marquee"
          src="/botblast/hero.png"
          alt="Bot Blast. Clean up your timeline. A pixel-art ship fires at an orange robot fleet."
          width="1400"
          height="560"
        />

        <section className="botblast-intro" aria-labelledby="botblast-intro-title">
          <div>
            <h2 id="botblast-intro-title">Turn the reply into the fight.</h2>
            <p>
              Bot Blast is a Chrome and Edge extension for X. Your avatar becomes
              the player ship. The selected account’s avatar becomes a three-wave
              fleet. Clear it quickly, earn a speed-and-accuracy score, and hide
              that handle in your browser.
            </p>
          </div>
          <div className="botblast-cta">
            <InstallControl />
            <p>No Bot Blast account or X login is required.</p>
          </div>
        </section>

        <section className="botblast-flow" aria-labelledby="botblast-flow-title">
          <h2 id="botblast-flow-title">Three waves. Then it’s gone.</h2>
          <ol>
            <li><strong>1</strong><span>Choose a suspicious reply on X.</span></li>
            <li><strong>2</strong><span>Clear three fast avatar waves.</span></li>
            <li><strong>3</strong><span>Score the run and hide the handle locally.</span></li>
          </ol>
        </section>

        <figure className="botblast-product-shot">
          <img
            src="/botblast/gameplay.png"
            alt="Bot Blast running over a still-visible X timeline with avatar ships in formation."
            width="1280"
            height="800"
          />
          <figcaption>The X timeline stays visible behind the game.</figcaption>
        </figure>

        <section className="botblast-score" aria-labelledby="botblast-score-title">
          <div>
            <h2 id="botblast-score-title">Fast and accurate wins.</h2>
            <p>
              Every completed run gets an anonymous leaderboard score. Clear
              time and accuracy help; getting hit costs points. The result screen
              also carries the same optional Stripe tip link used across
              mann.cool projects.
            </p>
          </div>
          <img
            src="/botblast/leaderboard.png"
            alt="Bot Blast fleet-cleared screen showing speed, accuracy, score, rank, and the optional tip link."
            width="1280"
            height="800"
          />
        </section>

        <section className="botblast-privacy" aria-labelledby="botblast-privacy-title">
          <h2 id="botblast-privacy-title">What happens after a win</h2>
          <p>
            Avatars stay in your browser. Winning hides the selected handle
            locally and sends its public handle, the public X post URL, an
            anonymous installation ID, and game performance to the Bot Blast
            registry and leaderboard. Cancelling sends nothing.
          </p>
          <p>
            Bot Blast does not sign into X, read your X password or cookies,
            block anyone, or file a report with X.
          </p>
          <nav aria-label="Privacy and support links">
            <a href={PRIVACY_URL}>Read the privacy policy <span aria-hidden="true">↗</span></a>
            <a href={SUPPORT_URL}>Support and registry appeals <span aria-hidden="true">↗</span></a>
          </nav>
        </section>
      </main>

      <footer className="botblast-footer">
        <a href="/">mann.cool</a>
        <span>Bot Blast by Jonathan Mann</span>
        <a href="mailto:jonathan@jonathanmann.net">jonathan@jonathanmann.net</a>
      </footer>
    </div>
  );
}
