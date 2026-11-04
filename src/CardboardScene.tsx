import { TrackballControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import {
  CanvasTexture,
  DirectionalLight,
  DoubleSide,
  Group,
  MathUtils,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
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
  noPan: boolean
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

// Marks shown on the flat net: folds are scored (a groove with a faint highlight
// alongside); the slits between neighbouring flaps are dashed.
const CREASE_COLOR = '#7a6a58'
const CREASE_WIDTH = 0.008
const CREASE_HIGHLIGHT_WIDTH = 0.004
const CREASE_LIFT = 0.002 // sits just above the board so it doesn't z-fight
const CREASE_OPACITY = 0.4
const CREASE_HIGHLIGHT_OPACITY = 0.3
const CREASE_DASH_LENGTH = 0.05
const CREASE_DASH_SPACING = 0.085 // dash + gap
const CREASE_DASH_THICKNESS = CREASE_WIDTH // same weight as the fold creases
const CREASE_DASH_OPACITY = 0.45
const CREASE_FADE_START = 0.85 // unfold progress at which creases start to appear

const FOLD_SECONDS = 2.4
const CAMERA_SECONDS = 1.1
const TAPE_SECONDS = 0.5 // tape fading off before unfolding, and back on once the box has closed
const FOV = 40
// Starting 3D view distance multiplier (1 = original framing); stays within maxDistance (14) on mobile
const HOME_ZOOM_OUT = 1.25

const smoothstep = (t: number) => t * t * (3 - 2 * t)

// Unfold timeline, as slices of fold progress (0 = closed box, 1 = flat die-cut).
// Like a real box: the large outer flaps open first, then the small inner flaps
// tucked beneath them, then the walls. Folding back plays this in reverse.
type Span = readonly [start: number, end: number]
const STAGES = {
  largeFlaps: [0, 1 / 3],
  smallFlaps: [1 / 3, 2 / 3],
  walls: [2 / 3, 1],
} as const satisfies Record<string, Span>

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
type CreaseMaterials = { groove: MeshBasicMaterial; highlight: MeshBasicMaterial; dots: MeshBasicMaterial }
const CreaseContext = createContext<CreaseMaterials | null>(null)

function makeCreaseMaterial(color: string, alphaMap?: Texture) {
  return new MeshBasicMaterial({
    color,
    alphaMap,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
}

// One round-ended dash per texture repeat; the dotted line tiles it along its length.
function makeDashTexture() {
  const w = 128
  const h = Math.max(4, Math.round((w * CREASE_DASH_THICKNESS) / CREASE_DASH_SPACING))
  const dash = (w * CREASE_DASH_LENGTH) / CREASE_DASH_SPACING
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.roundRect((w - dash) / 2, 0, dash, h, h / 2)
  ctx.fill()
  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  return texture
}

// A dotted line centred on `position`, used for the slits between neighbouring flaps.
function DottedLine({
  axis,
  length,
  position,
}: {
  axis: 'x' | 'y'
  length: number
  position: [number, number]
}) {
  const materials = useContext(CreaseContext)!
  const geometry = useMemo(() => {
    // Stretch the UVs so the dash texture repeats every CREASE_DASH_SPACING along the line
    const g = new PlaneGeometry(length, CREASE_DASH_THICKNESS)
    const uv = g.attributes.uv
    const repeats = Math.max(1, Math.round(length / CREASE_DASH_SPACING))
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * repeats)
    return g
  }, [length])
  return (
    <mesh
      geometry={geometry}
      material={materials.dots}
      position={[position[0], position[1], CREASE_LIFT]}
      rotation={[0, 0, axis === 'y' ? Math.PI / 2 : 0]}
    />
  )
}

// A scored fold line lying along the hinge axis, so rotation leaves it in place on the crease.
function Crease({ axis, length }: { axis: 'x' | 'y'; length: number }) {
  const materials = useContext(CreaseContext)!
  const offset = (CREASE_WIDTH + CREASE_HIGHLIGHT_WIDTH) / 2
  const along = (w: number): [number, number] => (axis === 'x' ? [length, w] : [w, length])
  const across = (d: number): [number, number, number] =>
    axis === 'x' ? [0, -d, CREASE_LIFT] : [d, 0, CREASE_LIFT]
  return (
    <>
      <mesh material={materials.groove} position={across(0)}>
        <planeGeometry args={along(CREASE_WIDTH)} />
      </mesh>
      <mesh material={materials.highlight} position={across(offset)}>
        <planeGeometry args={along(CREASE_HIGHLIGHT_WIDTH)} />
      </mesh>
    </>
  )
}

// A fold line that swings open during its slice (`span`) of the unfold.
function Hinge({
  position,
  axis,
  closed,
  span,
  foldLength,
  children,
}: {
  position: [number, number, number]
  axis: 'x' | 'y'
  closed: number
  span: Span
  foldLength: number
  children: ReactNode
}) {
  const ref = useRef<Group>(null)
  const progress = useContext(FoldContext)

  useFrame(() => {
    const p = progress.current
    const [start, end] = span
    const t = MathUtils.clamp((p - start) / (end - start), 0, 1)
    ref.current!.rotation[axis] = closed * (1 - smoothstep(t))
  })

  return (
    <group ref={ref} position={position} rotation={axis === 'x' ? [closed, 0, 0] : [0, closed, 0]}>
      <Crease axis={axis} length={foldLength} />
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
// `slits` are local x positions where this panel's flaps meet a neighbour's; each gets a
// dotted line on the net so the separate flaps read apart.
function Panel({ x0, width, inner, slits = [] }: { x0: number; width: number; inner: boolean; slits?: number[] }) {
  const cx = x0 + width / 2
  const w = Math.abs(width)
  const drop = inner ? INNER_FLAP_DROP : 0
  const flaps = inner ? STAGES.smallFlaps : STAGES.largeFlaps
  return (
    <>
      <Sheet width={w} height={HEIGHT} position={[cx, 0, 0]} />
      {[1, -1].map((dir) => (
        <Hinge
          key={dir}
          position={[cx, dir * (HEIGHT / 2 - drop), 0]}
          axis="x"
          closed={-dir * (Math.PI / 2)}
          span={flaps}
          foldLength={w}
        >
          <Sheet width={w} height={FLAP_DEPTH} position={[0, (dir * FLAP_DEPTH) / 2, 0]} />
          {slits.map((x) => (
            <DottedLine key={x} axis="y" length={FLAP_DEPTH} position={[x - cx, (dir * FLAP_DEPTH) / 2]} />
          ))}
        </Hinge>
      ))}
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

// `shown`: 0 = no tape, 1 = fully taped; CardboardBox drives it
function Tape({ shown }: { shown: RefObject<number> }) {
  const material = useMemo(
    () => new MeshStandardMaterial({ color: '#d8b77e', roughness: 0.35, transparent: true, opacity: 0.85 }),
    [],
  )
  const group = useRef<Group>(null)

  useFrame(() => {
    material.opacity = 0.85 * shown.current
    group.current!.visible = shown.current > 0
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

function CardboardBox({
  flat,
  progress,
  hold,
}: {
  flat: boolean
  progress: RefObject<number>
  hold: RefObject<boolean>
}) {
  const texture = useMemo(() => makeCardboardTexture(), [])
  const crease = useMemo<CreaseMaterials>(
    () => ({
      groove: makeCreaseMaterial(CREASE_COLOR),
      highlight: makeCreaseMaterial('#fff6e3'),
      dots: makeCreaseMaterial(CREASE_COLOR, makeDashTexture()),
    }),
    [],
  )
  const root = useRef<Group>(null)
  const tape = useRef(progress.current === 0 ? 1 : 0)

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    // Tape comes off before the box opens, and only goes back on once it's fully closed
    if (flat) tape.current = Math.max(0, tape.current - dt / TAPE_SECONDS)
    else if (progress.current === 0) tape.current = Math.min(1, tape.current + dt / TAPE_SECONDS)

    const target = flat ? 1 : 0
    // Hold the unfold while the camera heads back to its starting angle and while the tape comes off
    if (target > progress.current && (hold.current || tape.current > 0)) return
    const step = dt / FOLD_SECONDS
    progress.current =
      progress.current < target ? Math.min(target, progress.current + step) : Math.max(target, progress.current - step)

    // Slide the net so it ends up centered on the origin, facing the camera
    const t = smoothstep(progress.current)
    root.current!.position.set(-NET_CENTER_X * t, 0, (-DEPTH / 2) * t)

    // Creases only show once the net has (nearly) settled flat
    const fade = smoothstep(MathUtils.clamp((progress.current - CREASE_FADE_START) / (1 - CREASE_FADE_START), 0, 1))
    crease.groove.opacity = CREASE_OPACITY * fade
    crease.highlight.opacity = CREASE_HIGHLIGHT_OPACITY * fade
    crease.dots.opacity = CREASE_DASH_OPACITY * fade
    crease.groove.visible = crease.highlight.visible = crease.dots.visible = fade > 0
  })

  return (
    <FoldContext.Provider value={progress}>
      <TextureContext.Provider value={texture}>
        <CreaseContext.Provider value={crease}>
          <group ref={root}>
            {/* Front panel stays put; everything else unfolds into its plane */}
            <group position={[0, 0, DEPTH / 2]}>
              <Panel x0={-WIDTH / 2} width={WIDTH} inner={false} slits={[-WIDTH / 2, WIDTH / 2]} />

              <Hinge position={[WIDTH / 2, 0, 0]} axis="y" closed={Math.PI / 2} span={STAGES.walls} foldLength={HEIGHT}>
                <Panel x0={0} width={DEPTH} inner slits={[DEPTH]} />
                <Hinge position={[DEPTH, 0, 0]} axis="y" closed={Math.PI / 2} span={STAGES.walls} foldLength={HEIGHT}>
                  <Panel x0={0} width={WIDTH} inner={false} />
                  <Hinge position={[WIDTH, 0, 0]} axis="y" closed={Math.PI / 2} span={STAGES.walls} foldLength={HEIGHT}>
                    <GlueTab />
                  </Hinge>
                </Hinge>
              </Hinge>

              <Hinge position={[-WIDTH / 2, 0, 0]} axis="y" closed={-Math.PI / 2} span={STAGES.walls} foldLength={HEIGHT}>
                <Panel x0={0} width={-DEPTH} inner />
              </Hinge>
            </group>

            <Tape shown={tape} />
          </group>
        </CreaseContext.Provider>
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

const flatPose = (camera: PerspectiveCamera): Pose => ({
  position: new Vector3(0, 0, flatDistance(camera)),
  up: new Vector3(0, 1, 0),
  target: new Vector3(),
})
const homePose = (home: Vector3): Pose => ({ position: home.clone(), up: new Vector3(0, 1, 0), target: new Vector3() })

// Switching to 2D plays as a sequence, so the unfolding is seen from the starting angle:
//   toHome    -> camera returns to the starting 3D pose while the box stays closed
//   waitWalls -> flaps open from that angle; the camera holds still
//   toFlat    -> once the walls start to lay down, the camera turns to face the net
type Phase = 'toHome' | 'waitWalls' | 'toFlat' | 'free'

// Eases the camera between the starting 3D pose and a straight-on view of the flat net.
// Switching back to 3D, or changing `resetKey`, always returns to the starting pose:
// the previous 3D angle/zoom is never remembered.
function CameraRig({
  flat,
  home,
  resetKey,
  progress,
  hold,
}: {
  flat: boolean
  home: Vector3
  resetKey: number
  progress: RefObject<number>
  hold: RefObject<boolean>
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as Trackball | null
  const anim = useRef<{ from: Pose; to: Pose; t: number } | null>(null)
  const phase = useRef<Phase>('free')
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

    // Drop any leftover trackball momentum so it doesn't fight the animation
    controls._movePrev.copy(controls._moveCurr)
    controls._panStart.copy(controls._panEnd)
    controls._zoomStart.copy(controls._zoomEnd)
    controls._lastAngle = 0
    controls.enabled = false

    if (flat && flatChanged) {
      const homeP = homePose(home)
      const atHome =
        current.position.distanceTo(homeP.position) < 1e-3 &&
        current.target.lengthSq() < 1e-6 &&
        current.up.angleTo(homeP.up) < 1e-3
      if (atHome) {
        anim.current = null
        phase.current = 'waitWalls'
        hold.current = false
      } else {
        anim.current = { from: current, to: homeP, t: 0 }
        phase.current = 'toHome'
        hold.current = true
      }
      return
    }

    hold.current = false
    phase.current = flat ? 'toFlat' : 'free'
    anim.current = { from: current, to: flat ? flatPose(camera) : homePose(home), t: 0 }
  }, [flat, resetKey, camera, controls, home, hold])

  useFrame((_, delta) => {
    if (!controls) return

    if (phase.current === 'waitWalls') {
      if (progress.current < STAGES.walls[0]) return
      phase.current = 'toFlat'
      anim.current = {
        from: { position: camera.position.clone(), up: camera.up.clone(), target: controls.target.clone() },
        to: flatPose(camera),
        t: 0,
      }
    }

    const a = anim.current
    if (!a) return
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

    if (a.t < 1) return
    anim.current = null
    if (phase.current === 'toHome') {
      // Back at the starting angle: let the box unfold; the camera stays locked until it turns to face the net
      phase.current = 'waitWalls'
      hold.current = false
      return
    }
    phase.current = 'free'
    // In 2D, FlatDrag owns dragging (sideways only), so the trackball just zooms
    controls.noRotate = flat
    controls.noPan = flat
    controls.enabled = true
  })

  return null
}

// In the 2D view, dragging (mouse or one finger) slides the net around like a map.
// Stops once any edge of the net reaches screen center, so it can't be lost off screen.
function FlatDrag({ flat }: { flat: boolean }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as Trackball | null
  const el = useThree((s) => s.gl.domElement)

  useEffect(() => {
    if (!flat || !controls) return
    const touches = new Set<number>()
    let drag: { id: number; lastX: number; lastY: number } | null = null

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') touches.add(e.pointerId)
      // A second finger means pinch: hand it back to the trackball
      if (touches.size > 1) return void (drag = null)
      if (!controls.enabled || e.button !== 0) return
      drag = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY }
    }
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id || !controls.enabled) return
      // Pixels → world units on the net's plane, so the net stays under the pointer
      const dist = camera.position.distanceTo(controls.target)
      const worldPerPx = (2 * dist * Math.tan(MathUtils.degToRad(camera.fov / 2))) / el.clientHeight
      // Screen y grows downward, world y upward
      const nextX = controls.target.x - (e.clientX - drag.lastX) * worldPerPx
      const nextY = controls.target.y + (e.clientY - drag.lastY) * worldPerPx
      const dx = MathUtils.clamp(nextX, -NET_WIDTH / 2, NET_WIDTH / 2) - controls.target.x
      const dy = MathUtils.clamp(nextY, -NET_HEIGHT / 2, NET_HEIGHT / 2) - controls.target.y
      controls.target.x += dx
      controls.target.y += dy
      camera.position.x += dx
      camera.position.y += dy
      drag.lastX = e.clientX
      drag.lastY = e.clientY
    }
    const up = (e: PointerEvent) => {
      touches.delete(e.pointerId)
      if (drag?.id === e.pointerId) drag = null
    }

    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [flat, camera, controls, el])

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
  // Start further back on narrow screens so the whole box fits; HOME_ZOOM_OUT pulls both back a step
  const home = useMemo(
    () =>
      (window.innerWidth < 640 ? new Vector3(5.4, 3.9, 6.6) : new Vector3(3.6, 2.6, 4.4)).multiplyScalar(
        HOME_ZOOM_OUT,
      ),
    [],
  )
  // Fold progress (0 = closed box, 1 = flat die-cut), shared so the camera and the unfold can be sequenced
  const progress = useRef(flat ? 1 : 0)
  const foldHold = useRef(false)

  return (
    <Canvas camera={{ position: home.toArray(), fov: FOV }} gl={{ alpha: true }}>
      <ambientLight color="#fffaf0" intensity={1.4} />
      <CameraLight />

      <CardboardBox flat={flat} progress={progress} hold={foldHold} />
      {/* Trackball (unlike orbit) has no pole limits, so the box can be tumbled fully upside down */}
      <TrackballControls
        makeDefault
        minDistance={2.5}
        maxDistance={flat ? 40 : 14}
        rotateSpeed={3}
        zoomSpeed={1.5}
        dynamicDampingFactor={0.15}
      />
      <CameraRig flat={flat} home={home} resetKey={resetKey} progress={progress} hold={foldHold} />
      <FlatDrag flat={flat} />
      {onCameraFrame && <CameraReporter onFrame={onCameraFrame} />}
    </Canvas>
  )
}
