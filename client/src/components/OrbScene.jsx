import { useRef, useState, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars, MeshTransmissionMaterial } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

function OrbCore({ phase, orbColor, avatarMode }) {
  const ref = useRef();

  useFrame((state) => {
    if (!ref.current) return;
    const t    = state.clock.elapsedTime;
    const hz   = phase === 'listening' ? 6 : phase === 'responding' ? 4 : 1.2;
    const base = phase === 'responding' ? 6 : phase === 'listening' ? 4.5 : 2.5;
    ref.current.material.emissiveIntensity = base + Math.sin(t * hz) * 1.5;
  });

  return (
    <mesh ref={ref} scale={avatarMode ? 0.22 : 0.34}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshStandardMaterial
        color={orbColor}
        emissive={orbColor}
        emissiveIntensity={3}
        toneMapped={false}
      />
    </mesh>
  );
}

function OrbRings({ phase, orbColor, avatarMode }) {
  const r1 = useRef(), r2 = useRef(), r3 = useRef();
  const s  = avatarMode ? 0.78 : 1;

  useFrame((_, delta) => {
    if (!r1.current) return;
    const spd = phase === 'processing' ? 3.5 : phase === 'responding' ? 2 : 0.38;
    r1.current.rotation.z += delta * spd * 0.9;
    r2.current.rotation.x += delta * spd * 0.6;
    r3.current.rotation.y += delta * spd * 0.4;
    r3.current.rotation.z += delta * spd * 0.15;
  });

  return (
    <>
      <mesh ref={r1}>
        <torusGeometry args={[1.42 * s, 0.007, 4, 128]} />
        <meshStandardMaterial color={orbColor} emissive={orbColor} emissiveIntensity={2}   transparent opacity={0.9}  toneMapped={false} />
      </mesh>
      <mesh ref={r2} rotation={[Math.PI * 0.55, 0, Math.PI * 0.3]}>
        <torusGeometry args={[1.62 * s, 0.005, 4, 128]} />
        <meshStandardMaterial color={orbColor} emissive={orbColor} emissiveIntensity={1.5} transparent opacity={0.65} toneMapped={false} />
      </mesh>
      <mesh ref={r3} rotation={[Math.PI * 0.25, Math.PI * 0.4, 0]}>
        <torusGeometry args={[1.82 * s, 0.003, 4, 128]} />
        <meshStandardMaterial color={orbColor} emissive={orbColor} emissiveIntensity={1}   transparent opacity={0.45} toneMapped={false} />
      </mesh>
    </>
  );
}

function OrbSphere({ phase, rmsLevelRef, onClick }) {
  const ref = useRef();
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    if (!ref.current) return;
    const t   = state.clock.elapsedTime;
    const rms = rmsLevelRef.current;

    let scale;
    if (phase === 'idle')            scale = 1 + Math.sin(t * 0.65) * 0.03;
    else if (phase === 'listening')  scale = 1 + rms * 0.45 + Math.sin(t * 5) * 0.04;
    else if (phase === 'processing') scale = 1 + Math.sin(t * 2.2) * 0.025;
    else                             scale = 1 + Math.sin(t * 3.5) * 0.05;

    if (hovered && phase === 'idle') scale *= 1.06;
    ref.current.scale.setScalar(scale);
  });

  return (
    <mesh
      ref={ref}
      onClick={onClick}
      onPointerOver={() => { setHovered(true);  document.body.style.cursor = 'pointer'; }}
      onPointerOut={()  => { setHovered(false); document.body.style.cursor = '';         }}
    >
      <sphereGeometry args={[1, 64, 64]} />
      <MeshTransmissionMaterial
        backside
        samples={4}
        thickness={0.55}
        chromaticAberration={0.07}
        anisotropy={0.2}
        distortion={0.12}
        distortionScale={0.1}
        temporalDistortion={0.08}
        color="#001830"
      />
    </mesh>
  );
}

function Scene({ phase, rmsLevelRef, onOrbClick, orbColor, avatarMode }) {
  return (
    <>
      <color attach="background" args={['transparent']} />
      <Stars radius={90} depth={60} count={avatarMode ? 800 : 3500} factor={3} fade speed={0.4} />

      <ambientLight intensity={0.25} color="#003a5a" />
      <pointLight position={[3, 4, 3]}    intensity={2.5} color={orbColor} />
      <pointLight position={[-4, -3, -2]} intensity={1.2} color="#0055aa" />

      {!avatarMode && <OrbSphere phase={phase} rmsLevelRef={rmsLevelRef} onClick={onOrbClick} />}
      <OrbCore   phase={phase} orbColor={orbColor} avatarMode={avatarMode} />
      <OrbRings  phase={phase} orbColor={orbColor} avatarMode={avatarMode} />

      <EffectComposer>
        <Bloom intensity={avatarMode ? 2.2 : 1.8} luminanceThreshold={0.15} luminanceSmoothing={0.85} mipmapBlur />
      </EffectComposer>
    </>
  );
}

export function OrbScene({ phase, rmsLevelRef, onOrbClick, orbColor, avatarUrl }) {
  const avatarMode   = !!avatarUrl;
  const [imgOk, setImgOk] = useState(false);

  // probe avatar URL once on mount / when it changes
  useEffect(() => {
    if (!avatarUrl) { setImgOk(false); return; }
    const img = new Image();
    img.onload  = () => setImgOk(true);
    img.onerror = () => setImgOk(false);
    img.src = avatarUrl;
  }, [avatarUrl]);

  const showAvatar = avatarMode && imgOk;

  return (
    <div
      className="orb-compact-wrap"
      onClick={showAvatar ? onOrbClick : undefined}
      style={{ cursor: 'pointer' }}
    >
      <Canvas
        camera={{ position: [0, 0, 4.5], fov: showAvatar ? 50 : 38 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ width: '100%', height: '100%' }}
      >
        <Scene
          phase={phase}
          rmsLevelRef={rmsLevelRef}
          onOrbClick={!showAvatar ? onOrbClick : undefined}
          orbColor={orbColor}
          avatarMode={showAvatar}
        />
      </Canvas>

      {showAvatar && (
        <img
          src={avatarUrl}
          className={`orb-avatar-img orb-avatar-${phase}`}
          alt="agent avatar"
          draggable={false}
        />
      )}
    </div>
  );
}
