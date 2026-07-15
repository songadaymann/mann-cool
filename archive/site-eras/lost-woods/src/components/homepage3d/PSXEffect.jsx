import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

export function PSXEffect() {
  const { gl, scene } = useThree()

  useEffect(() => {
    gl.domElement.style.imageRendering = 'pixelated'
  }, [gl])

  // Set NearestFilter on all textures in the scene whenever it updates
  useEffect(() => {
    const setNearest = () => {
      scene.traverse((obj) => {
        if (obj.isMesh) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
          mats.forEach(mat => {
            if (mat.map) {
              mat.map.magFilter = THREE.NearestFilter
              mat.map.minFilter = THREE.NearestFilter
              mat.map.generateMipmaps = false
              mat.map.needsUpdate = true
            }
          })
        }
        // Also handle Points (fairy particles)
        if (obj.isPoints && obj.material?.map) {
          obj.material.map.magFilter = THREE.NearestFilter
          obj.material.map.minFilter = THREE.NearestFilter
          obj.material.map.generateMipmaps = false
          obj.material.map.needsUpdate = true
        }
      })
    }

    // Run immediately and again after a short delay for async-loaded models
    setNearest()
    const timer = setTimeout(setNearest, 2000)
    return () => clearTimeout(timer)
  }, [scene])

  return null
}
