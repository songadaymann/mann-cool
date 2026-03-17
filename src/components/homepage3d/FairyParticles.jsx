import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const FAIRY_COLORS = [
  new THREE.Color('#ffffff'),
  new THREE.Color('#ffaacc'),
  new THREE.Color('#ffee88'),
]

export function FairyParticles({ count = 12 }) {
  const pointsRef = useRef()

  const glowTexture = useMemo(() => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')

    const gradient = ctx.createRadialGradient(
      size / 2, size / 2, 0,
      size / 2, size / 2, size / 2
    )
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.6)')
    gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.2)')
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    return new THREE.CanvasTexture(canvas)
  }, [])

  const { basePositions, velocities, phases, baseSizes, colors } = useMemo(() => {
    const basePositions = new Float32Array(count * 3)
    const baseSizes = new Float32Array(count)
    const colors = new Float32Array(count * 3)
    const velocities = []
    const phases = []

    for (let i = 0; i < count; i++) {
      basePositions[i * 3] = -50 + Math.random() * 100
      basePositions[i * 3 + 1] = 25 + Math.random() * 45
      basePositions[i * 3 + 2] = -120 + Math.random() * 100

      baseSizes[i] = 8 + Math.random() * 14

      const color = FAIRY_COLORS[i % FAIRY_COLORS.length]
      colors[i * 3] = color.r
      colors[i * 3 + 1] = color.g
      colors[i * 3 + 2] = color.b

      velocities.push({
        x: 0.3 + Math.random() * 0.7,
        y: 0.2 + Math.random() * 0.5,
        z: 0.2 + Math.random() * 0.6,
        rx: 5 + Math.random() * 15,
        ry: 3 + Math.random() * 8,
        rz: 5 + Math.random() * 15,
      })
      phases.push(Math.random() * Math.PI * 2)
    }

    return { basePositions, velocities, phases, baseSizes, colors }
  }, [count])

  const positions = useMemo(() => new Float32Array(count * 3), [count])
  const sizes = useMemo(() => new Float32Array(count), [count])

  useFrame((state) => {
    if (!pointsRef.current) return
    const time = state.clock.elapsedTime
    const posArray = pointsRef.current.geometry.attributes.position.array
    const sizeArray = pointsRef.current.geometry.attributes.size.array

    for (let i = 0; i < count; i++) {
      const v = velocities[i]
      const p = phases[i]

      posArray[i * 3] = basePositions[i * 3] + Math.sin(time * v.x + p) * v.rx
      posArray[i * 3 + 1] = basePositions[i * 3 + 1] + Math.sin(time * v.y + p * 1.3) * v.ry
      posArray[i * 3 + 2] = basePositions[i * 3 + 2] + Math.cos(time * v.z + p * 0.7) * v.rz

      sizeArray[i] = baseSizes[i] * (0.7 + 0.5 * Math.sin(time * 2.5 + p))
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true
    pointsRef.current.geometry.attributes.size.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-size"
          count={count}
          array={sizes}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-color"
          count={count}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        map={glowTexture}
        size={12}
        sizeAttenuation
        transparent
        opacity={0.9}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexColors
      />
    </points>
  )
}
