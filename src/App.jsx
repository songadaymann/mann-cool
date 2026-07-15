export default function App() {
  return (
    <main className="holding-page">
      <header className="holding-header">
        <a className="wordmark" href="/" aria-label="mann.cool home">
          mann.cool
        </a>
        <p>games by Jonathan Mann</p>
      </header>

      <section className="holding-message" aria-labelledby="holding-title">
        <p className="eyebrow">The next version is taking shape.</p>
        <h1 id="holding-title">Games first.</h1>
        <p>
          A simpler mann.cool is on the way. The games will live at their own
          permanent links, without an arcade cabinet or play modal in the way.
        </p>
      </section>
    </main>
  );
}
