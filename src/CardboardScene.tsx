import { TrackballControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import {
  CanvasTexture,
  DirectionalLight,
  DoubleSide,
  Group,
  MathUtils,
  Mesh,
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
import { buildSankeySvg } from './print/sankeyPrint'
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
// On the closed box, the folds of the narrow (side) flaps are scored along the lid's
// short edges (across the tape too) and along the taped seam between the large flaps
const LID_CREASE_WIDTH = 0.012
const LID_CREASE_HIGHLIGHT_WIDTH = 0.006
const TAPE_CREASE_OPACITY_SCALE = 0.5 // creases on the tape show fainter, as if seen through it

// Shipping label stuck on the lid, over the tape (landscape, ~3:2 like a 4x6" label)
const LABEL_WIDTH = 1.2
const LABEL_HEIGHT = 0.8
const LABEL_LIFT = 2 * CREASE_LIFT // above the tape and the seam crease drawn on it
const LABEL_FONT = '"Poppins", "Inter", system-ui, sans-serif'
const SHIP_TO = ['48 Quincy Street', 'Cambridge, MA 02138']
const TRACKING_NUMBER = 'GSD 4813 8020 0271 3800'
// Harvard GSD "H" mark (public/label/gsd-logo.png): the glyph's bounds within the 3840x2160 PNG
const LOGO_CROP = { x: 1048, y: 27, w: 1744, h: 2106 }

// Sankey printed on the outside of the board (issue #29). It's laid out on the flat net and
// covers every wall and flap (not the glue tab), so folding the box breaks it across the edges
// like a real printed box. Net coordinates put the front panel's centre at the origin.
const PRINT_X0 = -WIDTH / 2 - DEPTH
const PRINT_X1 = WIDTH / 2 + DEPTH + WIDTH
const PRINT_Y1 = HEIGHT / 2 + FLAP_DEPTH
const PRINT_Y0 = -PRINT_Y1
const PRINT_PX_PER_UNIT = 300 // SVG px per scene unit the chart is laid out in
const PRINT_FONT_SIZE = 16 // SVG px (0.053 scene units)
const PRINT_PAD = 0.06 // clear margin inside the net's edges, scene units
const PRINT_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'
const PRINT_LIFT = CREASE_LIFT / 2 // between the board and the creases

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

// The print on the small flaps fades in (over TUCKED_FADE_SECONDS) as soon as the large flaps
// covering them start to open, and when closing fades out once those large flaps are back under
// TUCKED_HIDE_ANGLE.
const TUCKED_HIDE_ANGLE = 45 // degrees, of the large flaps' 90° swing
const TUCKED_FADE_SECONDS = 0.4
function tuckedPrintShown(p: number, opening: boolean) {
  const [start, end] = STAGES.largeFlaps
  // Same easing the hinge uses, so this tracks the large flaps' actual angle
  const opened = smoothstep(MathUtils.clamp((p - start) / (end - start), 0, 1)) * 90
  return opened > (opening ? 0 : TUCKED_HIDE_ANGLE) ? 1 : 0
}

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

// Paints the GSDelivery shipping label. The text is drawn once Poppins has loaded, so the
// canvas doesn't bake in a fallback font.
function makeLabelTexture() {
  const w = 1800
  const h = Math.round((w * LABEL_HEIGHT) / LABEL_WIDTH)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8

  const pad = 70
  const ink = '#111'
  const rule = (y: number, weight = 6) => ctx.fillRect(pad, y - weight / 2, w - 2 * pad, weight)

  const paint = () => {
    ctx.clearRect(0, 0, w, h)
    // Paper, with a thin printed border
    ctx.fillStyle = '#fbfaf5'
    ctx.beginPath()
    ctx.roundRect(0, 0, w, h, 28)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)'
    ctx.lineWidth = 4
    ctx.stroke()

    ctx.fillStyle = ink
    ctx.textBaseline = 'alphabetic'

    // Header: wordmark, service-class box
    ctx.font = `800 150px ${LABEL_FONT}`
    ctx.letterSpacing = '-4px'
    ctx.fillText('GSDelivery', pad, 205)
    ctx.letterSpacing = '0px'
    // Harvard GSD mark, top right, centred in the header band (above the rule at y = 300)
    const markH = 200
    const markW = (markH * LOGO_CROP.w) / LOGO_CROP.h
    const markCx = w - pad - markW / 2 // right edge on the margin
    if (logo.complete && logo.naturalWidth) {
      // Multiply drops the PNG's white background onto the label paper
      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(logo, LOGO_CROP.x, LOGO_CROP.y, LOGO_CROP.w, LOGO_CROP.h, markCx - markW / 2, (300 - markH) / 2, markW, markH)
      ctx.globalCompositeOperation = 'source-over'
    }

    rule(300, 10)

    // Ship to
    ctx.font = `600 48px ${LABEL_FONT}`
    ctx.fillText('SHIP TO:', pad, 380)
    ctx.font = `600 92px ${LABEL_FONT}`
    SHIP_TO.forEach((line, i) => ctx.fillText(line, pad + 250, 410 + i * 115))

    rule(620, 10)

    // Tracking barcode (a fixed pseudo-random pattern) with its number underneath
    ctx.font = `600 44px ${LABEL_FONT}`
    ctx.fillText('TRACKING #', pad, 680)
    let seed = 27
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const top = 705
    const bottom = h - 120
    for (let x = pad; x < w - pad - 16; ) {
      const bar = 6 + Math.floor(rand() * 4) * 6
      ctx.fillRect(x, top, bar, bottom - top)
      x += bar + 6 + Math.floor(rand() * 3) * 6
    }
    ctx.font = `600 52px ${LABEL_FONT}`
    ctx.textAlign = 'center'
    ctx.letterSpacing = '8px'
    ctx.fillText(TRACKING_NUMBER, w / 2, h - 55)
    ctx.letterSpacing = '0px'
    ctx.textAlign = 'left'

    texture.needsUpdate = true
  }

  const logo = new Image()
  logo.onload = paint
  logo.src = `${import.meta.env.BASE_URL}label/gsd-logo.png`

  paint()
  Promise.all(['800 150px', '600 92px'].map((f) => document.fonts.load(`${f} Poppins`)))
    .then(paint)
    .catch(() => {})
  return texture
}

// Paints the Sankey onto a transparent canvas covering the printed area of the net, with the
// "Corrugated box" node at the centre of the 2D view (NET_CENTER_X, 0).
function makePrintTexture(maxWidth: number) {
  const ppu = maxWidth / (PRINT_X1 - PRINT_X0) // canvas px per scene unit
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((PRINT_X1 - PRINT_X0) * ppu)
  canvas.height = Math.round((PRINT_Y1 - PRINT_Y0) * ppu)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 8

  // The chart is laid out straight onto the printed area, in SVG px of PRINT_PX_PER_UNIT
  const svg = buildSankeySvg({
    width: (PRINT_X1 - PRINT_X0) * PRINT_PX_PER_UNIT,
    height: (PRINT_Y1 - PRINT_Y0) * PRINT_PX_PER_UNIT,
    boxX: (NET_CENTER_X - PRINT_X0) * PRINT_PX_PER_UNIT,
    boxY: PRINT_Y1 * PRINT_PX_PER_UNIT,
    pad: PRINT_PAD * PRINT_PX_PER_UNIT,
    fontSize: PRINT_FONT_SIZE,
    font: PRINT_FONT,
    halo: '#c49a6c',
  })
  rasterize(svg, canvas.width, canvas.height)
    .then((image) => {
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      texture.needsUpdate = true
    })
    .catch(() => {})
  return texture
}

function rasterize(svg: SVGSVGElement, width: number, height: number) {
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }))
  const image = new Image()
  image.src = url
  return image.decode().then(
    () => (URL.revokeObjectURL(url), image),
    (e) => (URL.revokeObjectURL(url), Promise.reject(e)),
  )
}

// 0 = closed box, 1 = flat die-cut
const FoldContext = createContext<RefObject<number>>({ current: 0 })
const TextureContext = createContext<Texture | null>(null)
// `tucked` is the same print for the small flaps that close under the large ones: it only shows
// while the large flaps are open, so it's gone once they close over the small ones
type PrintMaterials = { open: MeshStandardMaterial; tucked: MeshStandardMaterial }
const PrintContext = createContext<PrintMaterials | null>(null)
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

// A piece of board. `net` is where its centre lies on the flat net; the outside face (+z)
// carries the slice of the print that falls there, so it travels with the sheet as it folds.
// `tucked` sheets (flaps that close under others) only show it while the flaps over them are open.
function Sheet({
  width,
  height,
  position,
  net,
  tucked = false,
}: {
  width: number
  height: number
  position: [number, number, number]
  net: [number, number]
  tucked?: boolean
}) {
  const texture = useContext(TextureContext)
  const print = useContext(PrintContext)
  const [netX, netY] = net
  const printGeometry = useMemo(() => {
    const g = new PlaneGeometry(width, height)
    const pos = g.attributes.position
    const uv = g.attributes.uv
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(
        i,
        (netX + pos.getX(i) - PRINT_X0) / (PRINT_X1 - PRINT_X0),
        (netY + pos.getY(i) - PRINT_Y0) / (PRINT_Y1 - PRINT_Y0),
      )
    }
    return g
  }, [width, height, netX, netY])
  return (
    <group position={position}>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial map={texture} roughness={0.9} side={DoubleSide} />
      </mesh>
      {print && (
        <mesh
          geometry={printGeometry}
          material={tucked ? print.tucked : print.open}
          position={[0, 0, PRINT_LIFT]}
          renderOrder={-1}
        />
      )}
    </group>
  )
}

// A wall panel with its top and bottom flaps. In local space the panel spans
// x from `x0` to `x0 + width` (width may be negative to grow leftward), outward is +z.
// `netX` is where the local origin lies on the flat net.
// `slits` are local x positions where this panel's flaps meet a neighbour's; each gets a
// dotted line on the net so the separate flaps read apart.
function Panel({
  x0,
  width,
  netX,
  inner,
  slits = [],
}: {
  x0: number
  width: number
  netX: number
  inner: boolean
  slits?: number[]
}) {
  const cx = x0 + width / 2
  const w = Math.abs(width)
  const drop = inner ? INNER_FLAP_DROP : 0
  const flaps = inner ? STAGES.smallFlaps : STAGES.largeFlaps
  return (
    <>
      <Sheet width={w} height={HEIGHT} position={[cx, 0, 0]} net={[netX + cx, 0]} />
      {[1, -1].map((dir) => (
        <Hinge
          key={dir}
          position={[cx, dir * (HEIGHT / 2 - drop), 0]}
          axis="x"
          closed={-dir * (Math.PI / 2)}
          span={flaps}
          foldLength={w}
        >
          <Sheet
            width={w}
            height={FLAP_DEPTH}
            position={[0, (dir * FLAP_DEPTH) / 2, 0]}
            net={[netX + cx, dir * (HEIGHT / 2 - drop + FLAP_DEPTH / 2)]}
            tucked={inner}
          />
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

// Scored lines along the closed lid's short edges (top and bottom), where the narrow
// flaps fold, continuing over the tape where it bends across those edges, plus one along
// the taped seam between the large flaps. They belong to the closed box and fade out as
// the large flaps open; the ones on the tape also come and go with the tape (`tape`).
function LidCreases({ tape }: { tape: RefObject<number> }) {
  const materials = useMemo(
    () => ({
      groove: makeCreaseMaterial(CREASE_COLOR),
      highlight: makeCreaseMaterial('#fff6e3'),
      tapeGroove: makeCreaseMaterial(CREASE_COLOR),
      tapeHighlight: makeCreaseMaterial('#fff6e3'),
    }),
    [],
  )
  const group = useRef<Group>(null)
  const progress = useContext(FoldContext)

  useFrame(() => {
    const [start, end] = STAGES.largeFlaps
    const fade = 1 - MathUtils.clamp((progress.current - start) / ((end - start) / 2), 0, 1)
    materials.groove.opacity = CREASE_OPACITY * fade
    materials.highlight.opacity = CREASE_HIGHLIGHT_OPACITY * fade
    const onTape = TAPE_CREASE_OPACITY_SCALE * fade * tape.current
    materials.tapeGroove.opacity = CREASE_OPACITY * onTape
    materials.tapeHighlight.opacity = CREASE_HIGHLIGHT_OPACITY * onTape
    group.current!.visible = fade > 0
  })

  // Lid surface, and the tape's top surface where it crosses the edge
  const runs = [
    { y: HEIGHT / 2, length: DEPTH, onTape: false },
    { y: HEIGHT / 2 + TAPE_THICKNESS, length: TAPE_WIDTH, onTape: true },
  ]
  // Groove hugs the edge; highlight runs alongside, further onto the lid
  const strips = (onTape: boolean) => [
    {
      material: onTape ? materials.tapeGroove : materials.groove,
      width: LID_CREASE_WIDTH,
      inset: LID_CREASE_WIDTH / 2,
    },
    {
      material: onTape ? materials.tapeHighlight : materials.highlight,
      width: LID_CREASE_HIGHLIGHT_WIDTH,
      inset: LID_CREASE_WIDTH + LID_CREASE_HIGHLIGHT_WIDTH / 2,
    },
  ]

  return (
    <group ref={group}>
      {[1, -1].map((face) => (
        <group key={face} scale={[1, face, 1]}>
          {[1, -1].map((side) =>
            runs.map(({ y, length, onTape }) =>
              strips(onTape).map(({ material, width, inset }) => (
                <mesh
                  key={`${side}${y}${width}`}
                  material={material}
                  position={[side * (WIDTH / 2 - inset), y + CREASE_LIFT, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  renderOrder={1} // after the (transparent) tape, so it shows on top of it
                >
                  <planeGeometry args={[width, length]} />
                </mesh>
              )),
            ),
          )}
          {/* The seam where the two large flaps meet, scored on top of the tape that joins them */}
          {strips(true).map(({ material, width, inset }) => (
            <mesh
              key={`seam${width}`}
              material={material}
              position={[0, HEIGHT / 2 + TAPE_THICKNESS + CREASE_LIFT, inset - LID_CREASE_WIDTH / 2]}
              rotation={[-Math.PI / 2, 0, 0]}
              renderOrder={1}
            >
              <planeGeometry args={[WIDTH, width]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

// The GSDelivery shipping label, centred on the lid over the tape. It's stuck to the tape,
// so it comes off and goes back on with it (`tape`).
function ShippingLabel({ tape }: { tape: RefObject<number> }) {
  const material = useMemo(
    () => {
      const texture = makeLabelTexture()
      return new MeshStandardMaterial({
        map: texture,
        // A touch of self-light keeps the paper reading white on the obliquely lit lid
        emissive: '#ffffff',
        emissiveMap: texture,
        emissiveIntensity: 0.35,
        roughness: 0.8,
        transparent: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    },
    [],
  )
  const mesh = useRef<Mesh>(null)

  useFrame(() => {
    material.opacity = tape.current
    mesh.current!.visible = tape.current > 0
  })

  return (
    <mesh
      ref={mesh}
      material={material}
      position={[0, HEIGHT / 2 + TAPE_THICKNESS + LABEL_LIFT, 0]}
      rotation={[-Math.PI / 2, 0, 0]} // text reads from the front, top of the label toward the back
      renderOrder={2} // after the tape and the creases on it
    >
      <planeGeometry args={[LABEL_WIDTH, LABEL_HEIGHT]} />
    </mesh>
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
  const maxTextureSize = useThree((s) => s.gl.capabilities.maxTextureSize)
  const print = useMemo<PrintMaterials>(() => {
    // Sharper print on desktop; phones get a lighter texture
    const width = Math.min(maxTextureSize, window.innerWidth < 640 ? 4096 : 8192)
    const open = new MeshStandardMaterial({
      map: makePrintTexture(width),
      roughness: 0.9,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
    const tucked = open.clone() // shares the texture
    tucked.opacity = tuckedPrintShown(progress.current, false)
    tucked.visible = tucked.opacity > 0
    return { open, tucked }
  }, [maxTextureSize, progress])
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

    // Print on the tucked-under flaps fades in as soon as the large flaps start to open, and out
    // once they're closing back under 45° (runs before any hold below, so a fade never stalls)
    const shown = tuckedPrintShown(progress.current, flat)
    const fadeStep = dt / TUCKED_FADE_SECONDS
    print.tucked.opacity =
      shown > print.tucked.opacity
        ? Math.min(shown, print.tucked.opacity + fadeStep)
        : Math.max(shown, print.tucked.opacity - fadeStep)
    print.tucked.visible = print.tucked.opacity > 0

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
        <PrintContext.Provider value={print}>
        <CreaseContext.Provider value={crease}>
          <group ref={root}>
            {/* Front panel stays put; everything else unfolds into its plane */}
            <group position={[0, 0, DEPTH / 2]}>
              <Panel x0={-WIDTH / 2} width={WIDTH} netX={0} inner={false} slits={[-WIDTH / 2, WIDTH / 2]} />

              <Hinge position={[WIDTH / 2, 0, 0]} axis="y" closed={Math.PI / 2} span={STAGES.walls} foldLength={HEIGHT}>
                <Panel x0={0} width={DEPTH} netX={WIDTH / 2} inner slits={[DEPTH]} />
                <Hinge position={[DEPTH, 0, 0]} axis="y" closed={Math.PI / 2} span={STAGES.walls} foldLength={HEIGHT}>
                  <Panel x0={0} width={WIDTH} netX={WIDTH / 2 + DEPTH} inner={false} />
                  <Hinge position={[WIDTH, 0, 0]} axis="y" closed={Math.PI / 2} span={STAGES.walls} foldLength={HEIGHT}>
                    <GlueTab />
                  </Hinge>
                </Hinge>
              </Hinge>

              <Hinge position={[-WIDTH / 2, 0, 0]} axis="y" closed={-Math.PI / 2} span={STAGES.walls} foldLength={HEIGHT}>
                <Panel x0={0} width={-DEPTH} netX={-WIDTH / 2} inner />
              </Hinge>
            </group>

            <Tape shown={tape} />
            <LidCreases tape={tape} />
            <ShippingLabel tape={tape} />
          </group>
        </CreaseContext.Provider>
        </PrintContext.Provider>
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

// Starting 2D view: how much closer than the whole-net framing (1 = whole net with margin)
const FLAT_ZOOM_IN = 1.2

// Starting distance for the 2D view: the framing that fits the whole net in the viewport (with
// margin for the title/switch), brought FLAT_ZOOM_IN closer so the print reads; drag to see the edges
function flatDistance(camera: PerspectiveCamera) {
  const tanHalf = Math.tan(MathUtils.degToRad(camera.fov / 2))
  const fitH = NET_HEIGHT / 2 / tanHalf
  const fitW = NET_WIDTH / 2 / (tanHalf * camera.aspect)
  return (Math.max(fitH, fitW) * 1.25) / FLAT_ZOOM_IN
}

// The free band between the page's upper and lower texts, in viewport px (top edge, bottom edge)
export type TextBand = () => { top: number; bottom: number } | null

// Straight-on view of the net, raised or lowered so the net sits midway between the page's upper
// and lower texts (`band`) rather than at the middle of the canvas
function flatPose(camera: PerspectiveCamera, canvas: HTMLElement, band?: TextBand): Pose {
  const dist = flatDistance(camera)
  let y = 0
  const b = band?.()
  if (b) {
    const rect = canvas.getBoundingClientRect()
    // How far below the canvas centre the band's middle is, in px, then in world units on the net
    const below = (b.top + b.bottom) / 2 - (rect.top + rect.height / 2)
    y = (below * 2 * dist * Math.tan(MathUtils.degToRad(camera.fov / 2))) / rect.height
  }
  return { position: new Vector3(0, y, dist), up: new Vector3(0, 1, 0), target: new Vector3(0, y, 0) }
}
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
  textBand,
}: {
  flat: boolean
  home: Vector3
  resetKey: number
  progress: RefObject<number>
  hold: RefObject<boolean>
  textBand?: TextBand
}) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const controls = useThree((s) => s.controls) as unknown as Trackball | null
  const canvas = useThree((s) => s.gl.domElement)
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
    anim.current = { from: current, to: flat ? flatPose(camera, canvas, textBand) : homePose(home), t: 0 }
  }, [flat, resetKey, camera, controls, home, hold, canvas, textBand])

  useFrame((_, delta) => {
    if (!controls) return

    if (phase.current === 'waitWalls') {
      if (progress.current < STAGES.walls[0]) return
      phase.current = 'toFlat'
      anim.current = {
        from: { position: camera.position.clone(), up: camera.up.clone(), target: controls.target.clone() },
        to: flatPose(camera, canvas, textBand),
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
  textBand,
}: {
  flat: boolean
  resetKey: number
  onCameraFrame?: (q: Quaternion) => void
  // Where the page's texts leave room, so the 2D view centres the net between them
  textBand?: TextBand
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
      <CameraRig
        flat={flat}
        home={home}
        resetKey={resetKey}
        progress={progress}
        hold={foldHold}
        textBand={textBand}
      />
      <FlatDrag flat={flat} />
      {onCameraFrame && <CameraReporter onFrame={onCameraFrame} />}
    </Canvas>
  )
}
