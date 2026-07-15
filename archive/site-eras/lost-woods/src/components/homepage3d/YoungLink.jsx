import { useRef, useEffect, useMemo } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader'
import * as THREE from 'three'

const TEXTURE_PATH = '/models/link/'

export function YoungLink({ linkDataRef }) {
  const mixerRef = useRef(null)
  const modelRef = useRef(null)

  const model = useLoader(FBXLoader, '/models/link/Young Link.fbx')
  const anim = useLoader(FBXLoader, '/models/link/Slow Run.fbx')

  const textures = useMemo(() => {
    const loader = new THREE.TextureLoader()
    const files = [
      '04001a40', '04001c40', '04001d40', '04001f40',
      '06005000', '06005200', '06005c00', '06006000',
      '06006400', '06006800', '06006880',
      '0600a1f0', '0600a2f0', '0600a3f0',
      '08000000', '09000000',
    ]
    const map = {}
    files.forEach(name => {
      const tex = loader.load(TEXTURE_PATH + name + '.png')
      tex.colorSpace = THREE.SRGBColorSpace
      tex.flipY = false
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      map[name] = tex
      map[name.toUpperCase()] = tex
    })
    return map
  }, [])

  useEffect(() => {
    if (!model) return

    model.traverse((child) => {
      if (child.isMesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material]
        mats.forEach((mat) => {
          const match = mat.name.match(/(?:mtl_)?([0-9a-fA-F]{8})/)
          if (match) {
            const texName = match[1]
            const tex = textures[texName] || textures[texName.toLowerCase()] || textures[texName.toUpperCase()]
            if (tex) {
              mat.map = tex
              mat.needsUpdate = true
            }
          }
          mat.color = new THREE.Color('#ffd8b0')
          mat.side = THREE.DoubleSide
          mat.transparent = false
          mat.alphaTest = 0
        })
      }
    })

    const mixer = new THREE.AnimationMixer(model)
    mixerRef.current = mixer

    if (anim.animations && anim.animations.length > 0) {
      const action = mixer.clipAction(anim.animations[0])
      action.play()
    }

    return () => mixer.stopAllAction()
  }, [model, anim, textures])

  useFrame((state, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta)
    }

    if (modelRef.current && linkDataRef?.current) {
      const d = linkDataRef.current
      const time = state.clock.elapsedTime
      const bridgeStart = d.zStart ?? -120
      const bridgeEnd = d.zEnd ?? 130
      const bridgeLen = bridgeEnd - bridgeStart

      const progress = ((time * d.speed) % 2)
      const forward = progress <= 1
      const t = forward ? progress : 2 - progress
      const runPos = bridgeStart + t * bridgeLen

      modelRef.current.position.x = runPos
      modelRef.current.position.y = d.y
      modelRef.current.position.z = d.x
      modelRef.current.scale.setScalar(d.scale)
      const rotOffset = (d.rotY ?? 0) * (Math.PI / 180)
      modelRef.current.rotation.y = (forward ? 0 : Math.PI) + rotOffset
    }
  })

  return (
    <primitive
      ref={modelRef}
      object={model}
      position={[0, 25, -120]}
      scale={[0.3, 0.3, 0.3]}
    />
  )
}
