export function TreeTrunks() {
  const trunks = [
    // Foreground — flanking the camera view
    { pos: [50, 0, -140], radius: 12, height: 200 },
    { pos: [110, 0, -100], radius: 15, height: 220 },
    // Near bridge ends
    { pos: [-20, 0, -160], radius: 18, height: 250 },
    { pos: [30, 0, 170], radius: 20, height: 230 },
    // Background atmosphere
    { pos: [-80, 0, -50], radius: 25, height: 200 },
    { pos: [160, 0, 50], radius: 22, height: 210 },
    { pos: [-60, 0, 100], radius: 16, height: 190 },
    { pos: [140, 0, -200], radius: 20, height: 240 },
  ]

  return (
    <group>
      {trunks.map((trunk, i) => (
        <mesh key={i} position={trunk.pos}>
          <cylinderGeometry args={[trunk.radius, trunk.radius * 1.2, trunk.height, 12]} />
          <meshStandardMaterial
            color="#5a4a30"
            roughness={0.9}
            metalness={0}
            emissive="#2a2010"
            emissiveIntensity={0.15}
          />
        </mesh>
      ))}

      {/* Ground plane — dark but warm */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
        <planeGeometry args={[800, 800]} />
        <meshStandardMaterial color="#2a2a18" roughness={1} metalness={0} />
      </mesh>
    </group>
  )
}
