import { useRef, useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import gamesData from '../../../games.json'
const games = gamesData.games

const ITEM_WIDTH = 40
const MAX_SCALE = 3.5
const MAGNIFY_RANGE = 140
const visibleGames = games.filter(g => !g.hidden)

export function GameDock() {
  const dockRef = useRef(null)
  const [mouseX, setMouseX] = useState(null)
  const navigate = useNavigate()

  // Preload all GIFs on mount so they're cached
  useEffect(() => {
    visibleGames.forEach(game => {
      const img = new Image()
      img.src = `/game-gifs/${game.slug}.gif`
    })
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!dockRef.current) return
    const rect = dockRef.current.getBoundingClientRect()
    setMouseX(e.clientX - rect.left)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setMouseX(null)
  }, [])

  const getScale = (index) => {
    if (mouseX === null) return 1
    const itemCenter = index * ITEM_WIDTH + ITEM_WIDTH / 2
    const dist = Math.abs(mouseX - itemCenter)
    if (dist > MAGNIFY_RANGE) return 1
    const scale = 1 + (MAX_SCALE - 1) * Math.cos((dist / MAGNIFY_RANGE) * (Math.PI / 2))
    return scale
  }

  // Find the most magnified item
  let peakIndex = -1
  if (mouseX !== null) {
    let maxScale = 1
    visibleGames.forEach((_, i) => {
      const s = getScale(i)
      if (s > maxScale) { maxScale = s; peakIndex = i }
    })
  }

  const activeGame = peakIndex >= 0 ? visibleGames[peakIndex] : null

  return (
    <>
      {activeGame && (
        <div className="dock-preview">
          <div className="dock-preview-title">{activeGame.title}</div>
          <img
            className="dock-preview-gif"
            src={`/game-gifs/${activeGame.slug}.gif`}
            alt={activeGame.title}
          />
        </div>
      )}
      <div className="game-dock-wrapper">
        <div
          className="game-dock"
          ref={dockRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {visibleGames.map((game, i) => {
            const scale = getScale(i)
            return (
              <div
                key={game.id}
                className="dock-item"
                style={{
                  width: ITEM_WIDTH,
                  transform: `scale(${scale})`,
                  zIndex: scale > 1 ? Math.round(scale * 10) : 1,
                }}
                onClick={() => navigate(`/${game.slug}`)}
              >
                <img
                  src={game.image}
                  alt={game.title}
                  draggable={false}
                />
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
