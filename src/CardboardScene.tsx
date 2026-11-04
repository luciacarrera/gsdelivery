import { TrackballControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import {
  CanvasTexture,
  DirectionalLight,
  DoubleSide,
  Group,
  MathUtils,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Shape,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
} from 'three'
// The bits of three-stdlib's TrackballControls we touch (momentum fields are private in its typings)
type Trackball = {
  enabled: boolean
  noRotate: boolean
  target: Vector3
  _movePrev: Vector2
  _moveCurr: Vector2
  _panStart: Vector2
  _panEnd: Vector2
  _zoomStart: Vector2
  _zoomEnd: Vector2
  _lastAngle: number
}

// Box dimensions (scene units)
const WIDTH = 2.4
const HEIGHT = 1.6
const DEPTH = 1.8
const TAPE_WIDTH = 0.36
const TAPE_DROP = 0.45
const TAPE_THICKNESS = 0.006

// Die-cut details
const FLAP_GAP = 0.006 // small gap where the outer flaps meet, so the seam reads
const FLAP_DEPTH = DEPTH / 2 - FLAP_GAP / 2
const INNER_FLAP_DROP = 0.004 // inner flaps sit just under the outer ones (no z-fighting)
const GLUE_TAB = 0.18
const GLUE_INSET = 0.004

// Flat net spans x ∈ [-W/2 - D, W/2 + D + W + tab]; this recenters it on the origin
const NET_CENTER_X = (WIDTH + GLUE_TAB) / 2
const NET_WIDTH = 2 * WIDTH + 2 * DEPTH + GLUE_TAB
const NET_HEIGHT = HEIGHT + DEPTH

const FOLD_SECONDS = 1.6
const CAMERA_SECONDS = 1.1
const FOV = 40

const smoothstep = (t: number) => t * t * (3 - 2 * t)

// Paints a kraft-paper texture.
function makeCardboardTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#c49a6c'
  ctx.fillRect(0, 0, size, size)

  // Faint corrugation bands
  for (let x = 0; x < size; x += 8) {
    ctx.fillStyle = 'rgba(80, 50, 20, 0.035)'
    ctx.fillRect(x, 0, 3, size)
  }

  // Paper fibers and speckles
  for (let i = 0; i < 7000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(90, 60, 30, 0.09)' : 'rgba(255, 240, 210, 0.08)'
    ctx.fillRect(Math.random() * size, Math.random() * size, Math.random() * 4 + 1, 1)
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

// 0 = closed box, 1 = flat die-cut
const FoldContext = createContext<RefObject<number>>({ current: 0 })
const TextureContext = createContext<Texture | null>(null)

// A fold line. Flaps swing during the first half of the unfold, walls during the second.
function Hinge({
  position,
  axis,
  closed,
  stage,
  children,
}: {
  position: [number, number, number]
  axis: 'x' | 'y'
  closed: number
  stage: 'flap' | 'wall'
  children: ReactNode
}) {
  const ref = useRef<Group>(null)
  const progress = useContext(FoldContext)

  useFrame(() => {
    const p = progress.current
    const t = MathUtils.clamp(stage === 'flap' ? p * 2 : p * 2 - 1, 0, 1)
    ref.current!.rotation[axis] = closed * (1 - smoothstep(t))
  })

  return (
    <group ref={ref} position={position} rotation={axis === 'x' ? [closed, 0, 0] : [0, closed, 0]}>
      {children}
    </group>
  )
}

function Sheet({ width, height, position }: { width: number; height: number; position: [number, number, number] }) {
  const texture = useContext(TextureContext)
  return (
    <mesh position={position}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={texture} roughness={0.9} side={DoubleSide} />
    </mesh>
  )
}

// A wall panel with its top and bottom flaps. In local space the panel spans
// x from `x0` to `x0 + width` (width may be negative to grow leftward), outward is +z.
function Panel({ x0, width, inner }: { x0: number; width: number; inner: boolean }) {
  const cx = x0 + width / 2
  const w = Math.abs(width)
  const drop = inner ? INNER_FLAP_DROP : 0
  return (
    <>
      <Sheet width={w} height={HEIGHT} position={[cx, 0, 0]} />
      <Hinge position={[cx, HEIGHT / 2 - drop, 0]} axis="x" closed={-Math.PI / 2} stage="flap">
        <Sheet width={w} height={FLAP_DEPTH} position={[0, FLAP_DEPTH / 2, 0]} />
      </Hinge>
      <Hinge position={[cx, -HEIGHT / 2 + drop, 0]} axis="x" closed={Math.PI / 2} stage="flap">
        <Sheet width={w} height={FLAP_DEPTH} position={[0, -FLAP_DEPTH / 2, 0]} />
      </Hinge>
    </>
  )
}

function GlueTab() {
  const texture = useContext(TextureContext)
  const shape = useMemo(() => {
    const taper = 0.12
    const s = new Shape()
    s.moveTo(0, -HEIGHT / 2)
    s.lineTo(GLUE_TAB, -HEIGHT / 2 + taper)
    s.lineTo(GLUE_TAB, HEIGHT / 2 - taper)
    s.lineTo(0, HEIGHT / 2)
    s.closePath()
    return s
  }, [])
  return (
    <mesh position={[0, 0, -GLUE_INSET]}>
      <shapeGeometry args={[shape]} />
      <meshStandardMaterial map={texture} roughness={0.9} side={DoubleSide} />
    </mesh>
  )
}

function Tape() {
  const material = useMemo(
    () => new MeshStandardMaterial({ color: '#d8b77e', roughness: 0.35, transparent: true, opacity: 0.85 }),
    [],
  )
  const group = useRef<Group>(null)
  const progress = useContext(FoldContext)

  // Tape spans the seams, so it peels away before anything opens
  useFrame(() => {
    const fade = 1 - MathUtils.clamp(progress.current * 4, 0, 1)
    material.opacity = 0.85 * fade
    group.current!.visible = fade > 0
  })

  return (
    <group ref={group}>
      {/* Packing tape over the top and bottom seams, folding down/up both ends */}
      {[1, -1].map((face) => (
        <group key={face} scale={[1, face, 1]}>
          <mesh material={material} position={[0, HEIGHT / 2 + TAPE_THICKNESS / 2, 0]}>
            <boxGeometry args={[WIDTH + TAPE_THICKNESS * 2, TAPE_THICKNESS, TAPE_WIDTH]} />
          </mesh>
          {[1, -1].map((side) => (
            <mesh
              key={side}
              material={material}
              position={[side * (WIDTH / 2 + TAPE_THICKNESS / 2), HEIGHT / 2 - TAPE_DROP / 2, 0]}
            >
              <boxGeometry args={[TAPE_THICKNESS, TAPE_DROP, TAPE_WIDTH]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

function CardboardBox({ flat }: { flat: boolean }) {
  const texture = useMemo(() => makeCardboardTexture(), [])
  const progress = useRef(flat ? 1 : 0)
  const root = useRef<Group>(null)

  useFrame((_, delta) => {
    const target = flat ? 1 : 0
    const step = Math.min(delta, 0.1) / FOLD_SECONDS
    progress.current =
      progress.current < target ? Math.min(target, progress.current + step) : Math.max(target, progress.current - step)

    // Slide the net so it ends up centered on the origin, facing the camera
    const t = smoothstep(progress.current)
    root.current!.position.set(-NET_CENTER_X * t, 0, (-DEPTH / 2) * t)
  })

  return (
    <FoldContext.Provider value={progress}>
      <TextureContext.Provider value={texture}>
        <group ref={root}>
          {/* Front panel stays put; everything else unfolds into its plane */}
          <group position={[0, 0, DEPTH / 2]}>
            <Panel x0={-WIDTH / 2} width={WIDTH} inner={false} />

            <Hinge position={[WIDTH / 2, 0, 0]} axis="y" closed={Math.PI / 2} stage="wall">
              <Panel x0={0} width={DEPTH} inner />
              <Hinge position={[DEPTH, 0, 0]} axis="y" closed={Math.PI / 2} stage="wall">
                <Panel x0={0} width={WIDTH} inner={false} />
                <Hinge position={[WIDTH, 0, 0]} axis="y" closed={Math.PI / 2} stage="wall">
                  <GlueTab />
                </Hinge>
              </Hinge>
            </Hinge>

            <Hinge position={[-WIDTH / 2, 0, 0]} axis="y" closed={-Math.PI / 2} stage="wall">
              <Panel x0={0} width={-DEPTH} inner />
            </Hinge>
          </group>

          <Tape />
        </group>
      </TextureContext.Provider>
    </FoldContext.Provider>
  )
}

// Light that sits at the camera, so whichever faces you're looking at stay lit
// (fixed lights leave the bottom and back dark once the box is flipped).
function CameraLight() {
  const light = useRef<DirectionalLight>(null)
  useFrame(({ camera }) => light.current?.position.copy(camera.position))
  return <directionalLight ref={light} color="#fffaf0" intensity={1.2} />
}

// Hands the camera's orientation to UI outside the canvas (e.g. the axis gizmo) every frame
function CameraReporter({ onFrame }: { onFrame: (q: Quaternion) => void }) {
  useFrame(({ camera }) => onFrame(camera.quaternion))
  return null
}

type Pose = { position: Vector3; up: Vector3; target: Vector3 }

// Distance at which the flat net fits the viewport (with margin for the title/switch)
function flatDistance(camera: PerspectiveCamera) {
  const tanHalf = Math.tan(MathUtils.degToRad(camera.fov / 2))
  const fitH = NET_HEIGHT / 2 / tanHalf
  const fitW = NET_WIDTH / 2 / (tanHalf * camera.aspect)
  return Math.max(fitH, fitW) * 1.25
}

// Eases the camera between the free 3D view and a straight-on view of the flat net,
// and back to the starting pose whenever `resetKey` changes.
function CameraRig({ flat, home, resetKey }: { flat: boolean; home: Vector3; resetKey: number }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as Trackball | null
  const anim = useRef<{ from: Pose; to: Pose; t: number } | null>(null)
  const last3D = useRef<Pose | null>(null)
  const shownFlat = useRef(flat)
  const shownReset = useRef(resetKey)

  useEffect(() => {
    if (!controls) return
    const flatChanged = shownFlat.current !== flat
    const resetRequested = shownReset.current !== resetKey
    if (!flatChanged && !resetRequested) return
    shownFlat.current = flat
    shownReset.current = resetKey

    const current: Pose = {
      position: camera.position.clone(),
      up: camera.up.clone(),
      target: controls.target.clone(),
    }
    if (flatChanged && flat) last3D.current = current
    if (resetRequested) last3D.current = null

    const to: Pose = flat
      ? { position: new Vector3(0, 0, flatDistance(camera)), up: new Vector3(0, 1, 0), target: new Vector3() }
      : (last3D.current ?? { position: home.clone(), up: new Vector3(0, 1, 0), target: new Vector3() })

    // Drop any leftover trackball momentum so it doesn't fight the animation
    controls._movePrev.copy(controls._moveCurr)
    controls._panStart.copy(controls._panEnd)
    controls._zoomStart.copy(controls._zoomEnd)
    controls._lastAngle = 0

    controls.enabled = false
    anim.current = { from: current, to, t: 0 }
  }, [flat, resetKey, camera, controls, home])

  useFrame((_, delta) => {
    const a = anim.current
    if (!a || !controls) return
    a.t = Math.min(1, a.t + Math.min(delta, 0.1) / CAMERA_SECONDS)
    const e = smoothstep(a.t)

    // Swing around the target (slerp direction, lerp distance) so the camera never cuts through the box
    const target = a.from.target.clone().lerp(a.to.target, e)
    const fromOff = a.from.position.clone().sub(a.from.target)
    const toOff = a.to.position.clone().sub(a.to.target)
    const dist = MathUtils.lerp(fromOff.length(), toOff.length(), e)
    const q = new Quaternion().setFromUnitVectors(fromOff.clone().normalize(), toOff.clone().normalize())
    const dir = fromOff.normalize().applyQuaternion(new Quaternion().slerp(q, e))

    camera.position.copy(target).addScaledVector(dir, dist)
    const upQ = new Quaternion().setFromUnitVectors(a.from.up.clone().normalize(), a.to.up.clone().normalize())
    camera.up.copy(a.from.up).normalize().applyQuaternion(new Quaternion().slerp(upQ, e))
    controls.target.copy(target)
    camera.lookAt(target)

    if (a.t >= 1) {
      anim.current = null
      controls.noRotate = flat
      controls.enabled = true
    }
  })

  return null
}

export default function CardboardScene({
  flat,
  resetKey,
  onCameraFrame,
}: {
  flat: boolean
  resetKey: number
  onCameraFrame?: (q: Quaternion) => void
}) {
  // Start further back on narrow screens so the whole box fits
  const home = useMemo(
    () => (window.innerWidth < 640 ? new Vector3(5.4, 3.9, 6.6) : new Vector3(3.6, 2.6, 4.4)),
    [],
  )

  return (
    <Canvas camera={{ position: home.toArray(), fov: FOV }} gl={{ alpha: true }}>
      <ambientLight color="#fffaf0" intensity={1.4} />
      <CameraLight />

      <CardboardBox flat={flat} />
      {/* Trackball (unlike orbit) has no pole limits, so the box can be tumbled fully upside down */}
      <TrackballControls
        makeDefault
        minDistance={2.5}
        maxDistance={flat ? 40 : 14}
        rotateSpeed={3}
        zoomSpeed={1.5}
        dynamicDampingFactor={0.15}
      />
      <CameraRig flat={flat} home={home} resetKey={resetKey} />
      {onCameraFrame && <CameraReporter onFrame={onCameraFrame} />}
    </Canvas>
  )
}
