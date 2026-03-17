import { useLoader } from '@react-three/fiber'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader'
import { useEffect } from 'react'
import * as THREE from 'three'

export function BridgeModel() {
  const materials = useLoader(MTLLoader, '/models/bridge/bridge.mtl', (loader) => {
    loader.setResourcePath('/models/bridge/')
  })

  const obj = useLoader(OBJLoader, '/models/bridge/bridge.obj', (loader) => {
    materials.preload()
    loader.setMaterials(materials)
  })

  useEffect(() => {
    obj.traverse((child) => {
      if (child.isMesh) {
        if (child.material.map) {
          child.material.map.colorSpace = THREE.SRGBColorSpace
          child.material.map.magFilter = THREE.NearestFilter
          child.material.map.minFilter = THREE.NearestFilter
          child.material.map.generateMipmaps = false
          child.material.map.needsUpdate = true
        }
        child.material.side = THREE.DoubleSide
        child.material.transparent = true
        child.material.alphaTest = 0.5
        child.material.emissive = new THREE.Color('#3a3020')
        child.material.emissiveIntensity = 0.2
      }
    })
  }, [obj])

  return (
    <primitive
      object={obj}
      position={[0, 0, 0]}
      rotation={[0, 0, 0]}
      scale={[1, 1, 1]}
    />
  )
}
