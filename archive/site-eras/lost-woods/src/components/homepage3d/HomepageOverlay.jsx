import { Link } from 'react-router-dom'
import './homepage3d.css'

export function HomepageOverlay() {
  return (
    <div className="homepage-overlay">
      <div className="homepage-title-area">
        <h1 className="homepage-title">mann.cool</h1>
        <p className="homepage-tagline">games by jonathan mann</p>
      </div>
      <div className="homepage-enter-area">
        <Link to="/old" className="homepage-enter-link">
          Enter the Arcade
        </Link>
      </div>
    </div>
  )
}
