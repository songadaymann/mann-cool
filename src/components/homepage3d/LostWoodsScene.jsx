import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Suspense, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { BridgeModel } from './BridgeModel'
import { FairyParticles } from './FairyParticles'
import { TreeTrunks } from './TreeTrunks'
import { YoungLink } from './YoungLink'
import { PSXEffect } from './PSXEffect'
import { GameDock } from './GameDock'
import './homepage3d.css'

export function LostWoodsScene() {
  const linkDataRef = useRef({ scale: 0.04, x: -6, y: 28, speed: 0.2, rotY: 93, zStart: -60, zEnd: 55 })

  // Disable scanlines on this page
  useEffect(() => {
    document.body.classList.add('no-scanlines')
    return () => document.body.classList.remove('no-scanlines')
  }, [])

  return (
    <div className="lost-woods-container">
      <Canvas
        dpr={0.25}
        camera={{
          fov: 60,
          near: 0.1,
          far: 1000,
          position: [-14.33, 62.62, -80.69],
          rotation: [-2.7108, -0.1309, -3.0817],
        }}
        gl={{
          antialias: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.8,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
        {/* Warm khaki/beige fog to match OoT Lost Woods */}
        <color attach="background" args={['#8a8a6a']} />
        <fogExp2 attach="fog" args={['#9a9a78', 0.007]} />

        {/* Warm, bright ambient — not green */}
        <ambientLight intensity={0.7} color="#c8c0a0" />
        <directionalLight
          position={[50, 100, -50]}
          intensity={1.0}
          color="#d0c8a0"
        />
        {/* Subtle warm fill lights */}
        <pointLight position={[0, 40, 0]} intensity={0.5} color="#b0a878" distance={300} />
        <pointLight position={[-60, 20, -80]} intensity={0.3} color="#a8a070" distance={200} />

        <PSXEffect />
        <OrbitControls target={[0, 20, 100]} zoomSpeed={0.3} />

        <Suspense fallback={null}>
          <BridgeModel />
          <TreeTrunks />
          <FairyParticles count={12} />
          <YoungLink linkDataRef={linkDataRef} />
        </Suspense>
      </Canvas>
      <div className="title-overlay">
        <h1>mann.cool</h1>
        <p>games by jonathan mann</p>
      </div>
      <GameDock />
    </div>
  )
}
