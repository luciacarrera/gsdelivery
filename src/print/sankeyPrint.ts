// Builds the Sankey printed on the box (issue #29) as a static SVG, from
// cardboard_box_buyers_sankey_v10.html. Left (mirrored): climate impact of 1 kg of corrugated box
// by upstream source. Right: North American box demand by buyer industry and company, then end
// of life. Tooltips and theme switching are dropped: it's ink on cardboard, in the light palette.
//
// Unlike the source page, the chart is laid out straight onto the printed area (the whole net but
// the glue tab): the columns spread across its width, the node spacing grows until it fills its
// height, and the text has its own size, wrapping where it runs out of room.
import { sankey, sankeyLeft, sankeyLinkHorizontal, type SankeyLink, type SankeyNode } from 'd3-sankey'
import { create, type Selection } from 'd3-selection'
import { CHAIN, PROCESS_LINKS, PROCESSES } from './sankeyData'

// Light-theme palette from the source page
const TEXT = '#0b0b0b'
const TEXT2 = '#52514e'
const MUTED = '#8a8984'
const CAT_COLOR: Record<string, string> = {
  box: '#2a78d6',
  board: '#2a78d6',
  elec: '#eda100',
  gas: '#eb6834',
  trans: '#1baf7a',
  waste: '#6250d6',
  chem: '#e87ba4',
  maize: '#008300',
  heat: '#e34948',
  recyc: '#5f9a1c',
  other: '#b9b8b2',
}
// Node bars that need a stronger colour than their bands to stand out on the kraft
const NODE_COLOR: Record<string, string> = { trans: '#00a3a3' }
const FLUTE = '#6cb4f0'
const LINER = '#1f5fb0'
const CHAIN_COLOR = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#5f9a1c', '#e34948', '#c27a1a']
const CHAIN_ROOT = '#52514e'
// Bands are stronger than on screen (0.38 there): over brown kraft the thinner tint reads grey
const LINK_OPACITY = 0.55
const NW = 12 // node width
const GROUP_GAP = 26 // between the groups of inputs in the climate-impact columns
const MAX_LINES = 3
// Sizes from the source page (11.5px labels), scaled with the printed font size
const SRC_FONT = 11.5
const SRC_GAP = 60 // whitespace splitting the box, industry and used-box columns into an in and an out bar
const SRC_LOOP_W = 12 // recycling loop where it re-enters on the left
const SRC_COLNAME = 15 // column names, letters stacked top to bottom

// The captions are shown beside the box rather than printed on it
export const CAPTIONS = [
  "Left: climate impact of 1 kg of cardboard box (normalized global warming, ×10⁻⁶; width = share of the box's footprint)",
  'Right: box demand, North America 2025 (million tonnes)',
]
// Phone version: a headline and units per side; the band-width note moves to the About sheet
export const CAPTIONS_SHORT = [
  { side: 'left', title: 'Climate impact', detail: '1 kg of box · global warming ×10⁻⁶' },
  { side: 'right', title: 'Box demand', detail: 'North America 2025 · million tonnes' },
] as const
export const CAPTION_NOTE = "On the left, each band's width is its share of the box's climate footprint."

export type SankeyPrintOptions = {
  // Printed area, in SVG px
  width: number
  height: number
  // Where the centre of the "Corrugated box" node goes
  boxX: number
  boxY: number
  // Clear margin kept inside the printed area's edges
  pad: number
  // Extra strip past the right edge (the glue tab) that only the recycling loop runs onto
  bleed?: number
  fontSize: number
  font: string
  // Outline drawn behind labels so they stay legible over the bands (the board colour, so it reads as bare cardboard)
  halo: string
}

type PNode = { id: string; name: string; full: number; cat: string; rem?: boolean; dummy?: boolean }
type PLink = { source: string; target: string; value: number; rs?: string; rt?: string }
// d3-sankey 0.12 also sets `layer` (the column), which the typings don't list yet
type GNode = SankeyNode<PNode, PLink> & { layer?: number }
type GLink = SankeyLink<PNode, PLink>
// d3-sankey sets these on its nodes/links; the typings mark them optional
const n = (v: number | undefined) => v ?? 0
const nodeOf = (v: GLink['source']) => v as GNode

// A label is lines of segments, so a value can share a line with a name in a lighter colour
type Seg = { text: string; cls?: string }
type Line = Seg[]

function makeText(font: string, size: number) {
  const ctx = document.createElement('canvas').getContext('2d')!
  const width = (text: string, bold = false) => {
    ctx.font = `${bold ? 600 : 400} ${size}px ${font}`
    return ctx.measureText(text).width
  }
  // Greedy word wrap to `maxW`, at most MAX_LINES lines (the last one takes any overflow)
  const wrap = (text: string, maxW: number, bold = false) => {
    const lines: string[] = []
    for (const word of text.split(' ')) {
      const last = lines.length - 1
      if (last >= 0 && (width(`${lines[last]} ${word}`, bold) <= maxW || lines.length === MAX_LINES)) {
        lines[last] += ` ${word}`
      } else lines.push(word)
    }
    return lines
  }
  // `name` wrapped, with `value` after it on the last line if it fits, else on its own line
  const nameValue = (name: string, value: string, maxW: number, ownLine = false): Line[] => {
    const lines: Line[] = wrap(name, maxW).map((t) => [{ text: t }])
    const last = lines[lines.length - 1]
    if (!ownLine && width(`${last[0].text} ${value}`) <= maxW) last.push({ text: ` ${value}`, cls: 'v' })
    else lines.push([{ text: value, cls: 'v' }])
    return lines
  }
  const lineWidth = (line: Line) => width(line.map((s) => s.text).join(''), line.some((s) => s.cls === 'ttl'))
  const blockWidth = (lines: Line[]) => Math.max(...lines.map(lineWidth))
  return { width, wrap, nameValue, blockWidth }
}

// Upstream (climate impact) graph, before layout
function gwpGraph() {
  const byId = Object.fromEntries(PROCESSES.map((p) => [p[0], p[4]]))
  const nodes: PNode[] = PROCESSES.map(([id, name, , , full, cat]) => ({ id, name, full, cat }))
  const links: PLink[] = PROCESS_LINKS.map(([source, target, value]) => ({ source, target, value }))

  // Whatever a process emits beyond its listed inputs becomes a grey "on-site" node
  const kids = new Set(PROCESS_LINKS.map((l) => l[0]))
  const REM_MIN = 0.15
  for (const p of kids) {
    const out = PROCESS_LINKS.filter((l) => l[0] === p).reduce((a, l) => a + l[2], 0)
    const inflow = p === 'box' ? byId[p] : PROCESS_LINKS.filter((l) => l[1] === p).reduce((a, l) => a + l[2], 0)
    const rem = +(inflow - out).toFixed(2)
    if (rem > REM_MIN) {
      const id = `${p}_rem`
      nodes.push({ id, name: 'On-site emissions & minor inputs', full: rem, cat: 'other', rem: true })
      links.push({ source: p, target: id, value: rem })
    }
  }

  // Links that skip columns are routed through invisible pass-through nodes ("lanes"),
  // so every band only joins the column next to it and the lanes can be ordered to avoid crossings.
  const LANES: Record<string, number> = { 'box>el': 2, 'box>ngm': 2, 'box>msm': 2, 'cbm>lor': 1 }
  const catOf = (id: string) => nodes.find((d) => d.id === id)?.cat ?? 'other'
  for (const [key, count] of Object.entries(LANES)) {
    const [p, c] = key.split('>')
    const i = links.findIndex((l) => l.source === p && l.target === c)
    const v = links[i].value
    links.splice(i, 1)
    let prev = p
    for (let k = 1; k <= count; k++) {
      const id = `${c}~${p}~${k}`
      nodes.push({ id, dummy: true, cat: catOf(c), name: '', full: v })
      links.push({ source: prev, target: id, value: v, rs: p, rt: c })
      prev = id
    }
    links.push({ source: prev, target: c, value: v, rs: p, rt: c })
  }
  return { nodes, links, total: 51.4 }
}

// Column order (top → bottom). Lanes to the box run along the top (electricity, natural gas)
// and the bottom (starch glue); truck delivery runs just under the mill.
const ORDER = [
  'el~box~1', 'ngm~box~1', 'cbm', 'msm~box~1', 'box_rem',
  'el~box~2', 'ngm~box~2', 'cbp', 'lor~cbm~1', 'trm', 'msm~box~2',
  'el', 'ngm', 'ht', 'coal', 'wpg', 'pw', 'chip', 'lime', 'inf', 'msw', 'slu', 'cbp_rem', 'lor', 'trp', 'msm',
  'wpc', 'msp',
]
// Input groups: energy, raw materials, transport, then waste and the grey remainder
const GRP: Record<string, number> = {
  el: 0, ht: 0, ngm: 0, coal: 0,
  wpg: 1, wpc: 1, pw: 1, chip: 1, lime: 1, inf: 1,
  msw: 2, slu: 2, cbp_rem: 3, lor: 4, trp: 4, msm: 5, msp: 5,
}

// Nodes labelled right above their bar, under the electricity / natural gas lanes that run over
// them to the box; `headroom` opens the room for that label between the bar and the lanes
const HEADED = new Set(['cbm', 'cbp'])

// Lays out the climate-impact Sankey in its own (unmirrored) frame: the box node at x = 0,
// the inputs spreading right to `width`, nodes within y ∈ [0, height] plus the group gaps.
function layoutGwp(width: number, height: number, padding: number, headroom = 0) {
  const { nodes, links, total } = gwpGraph()
  const ord: Record<string, number> = {}
  ORDER.forEach((id, i) => (ord[id] = i))
  nodes.forEach((d, i) => (ord[d.id] ??= 100 + i))
  const sk = sankey<PNode, PLink>()
    .nodeId((d) => d.id)
    .nodeWidth(NW)
    .nodePadding(padding)
    .nodeAlign(sankeyLeft)
    .extent([
      [0, 0],
      [width, height],
    ])
    .nodeSort((a, b) => ord[a.id] - ord[b.id])
  const G = sk({ nodes, links })
  // Open a gap between groups in the input columns, then re-route the links
  G.nodes.forEach((d) => {
    const g = GRP[d.id]
    if (n((d as GNode).layer) >= 3 && g !== undefined) {
      d.y0 = n(d.y0) + g * GROUP_GAP
      d.y1 = n(d.y1) + g * GROUP_GAP
    }
  })
  // Lift whatever sits above a headed node in its column (the lanes) to make room for its label
  if (headroom > 0) {
    const layer = (d: GNode) => n((d as GNode).layer)
    for (const h of G.nodes.filter((d) => HEADED.has(d.id))) {
      G.nodes
        .filter((e) => e !== h && layer(e) === layer(h) && n(e.y1) <= n(h.y0) + 0.5)
        .forEach((e) => {
          e.y0 = n(e.y0) - headroom
          e.y1 = n(e.y1) - headroom
        })
    }
  }
  G.nodes.forEach((d) => {
    d.sourceLinks?.sort((a, b) => n(nodeOf(a.target).y0) - n(nodeOf(b.target).y0))
    d.targetLinks?.sort((a, b) => n(nodeOf(a.source).y0) - n(nodeOf(b.source).y0))
  })
  sk.update(G)
  const box = G.nodes.find((d) => d.id === 'box')!
  return { G, total, box, maxLayer: Math.max(...G.nodes.map((d) => n((d as GNode).layer))) }
}

// `xo`: offset of a split column's out bar from its in bar (0 when not split)
type CNode = { i: number; label: string; cat: number; value: number; h: number; x0: number; x1: number; xo: number; y0: number; y1: number }
type ChainCols = { ind: number; leaf: number; used: number; out: number }

// Lays out the demand chain to the right of the box (root's right edge at x = 0), scaled so its
// root matches the box node's height. `leafSlot(i)` is the least height leaf i may take (its label).
// The industry and used-box columns are split by `gap` into an in bar (at X) and an out bar.
function layoutChain(
  hBox: number,
  X: ChainCols,
  gap: number,
  leafSlot: (i: number) => number,
  lh: number,
  nm: { w: number; h: number },
) {
  const CH = CHAIN
  const count = CH.labels.length
  const U = count - 4
  const R = U + 1
  const L = U + 2
  const Wt = U + 3
  const val = new Array<number>(count).fill(0)
  const inv = new Array<number>(count).fill(0)
  CH.src.forEach((s, k) => (val[s] += CH.val[k]))
  CH.tgt.forEach((t, k) => (inv[t] += CH.val[k]))
  for (let i = 0; i < count; i++) if (!val[i]) val[i] = inv[i]
  const total = val[0]
  const ky = hBox / total
  const nodes: CNode[] = CH.labels.map((label, i) => ({ i, label, cat: CH.cat[i], value: val[i], h: val[i] * ky, x0: 0, x1: 0, xo: 0, y0: 0, y1: 0 }))
  nodes.forEach((d, i) => {
    d.x0 = i === 0 ? -NW : i <= 5 ? X.ind : i < U ? X.leaf : i === U ? X.used : X.out
    d.x1 = d.x0 + NW
    d.xo = (i >= 1 && i <= 5) || i === U ? gap : 0
  })
  const leaves = nodes.filter((d) => d.i >= 6 && d.i < U).sort((a, b) => a.cat - b.cat || a.i - b.i)
  let cur = 0
  let prev: number | null = null
  const span: Record<number, [number, number]> = {}
  leaves.forEach((d) => {
    if (prev !== null && d.cat !== prev) cur += lh * 0.7
    prev = d.cat
    const slot = Math.max(d.h + 3, leafSlot(d.i))
    d.y0 = cur + (slot - d.h) / 2
    d.y1 = d.y0 + d.h
    span[d.cat] ??= [cur, cur]
    span[d.cat][1] = cur + slot
    cur += slot
  })
  for (let i = 1; i <= 5; i++) {
    const s = span[i - 1]
    const d = nodes[i]
    const mid = (s[0] + s[1]) / 2
    d.y0 = mid - d.h / 2
    d.y1 = d.y0 + d.h
  }
  const cy = cur / 2
  ;[0, U].forEach((i) => {
    const d = nodes[i]
    d.y0 = cy - d.h / 2
    d.y1 = d.y0 + d.h
  })
  // End of life: recycling (drawn as the loop, not a node) level with the used boxes, landfill and waste-to-energy stacked under it
  // with room for their two-line labels, then the "Not measured" note
  const rec = nodes[R]
  const lf = nodes[L]
  const wte = nodes[Wt]
  rec.y0 = nodes[U].y0
  rec.y1 = rec.y0 + rec.h
  const lfc = rec.y1 + lh * 1.6
  lf.y0 = lfc - lf.h / 2
  lf.y1 = lf.y0 + lf.h
  const wc = lfc + lh * 2.4
  wte.y0 = wc - wte.h / 2
  wte.y1 = wte.y0 + wte.h
  const note = { x: rec.x1 + 10, w: nm.w, h: nm.h, y: wc + lh * 1.6 }
  const links = CH.src.map((s, k) => ({
    k,
    source: nodes[s],
    target: nodes[CH.tgt[k]],
    width: CH.val[k] * ky,
    lc: CH.lc[k],
    y0: 0,
    y1: 0,
  }))
  nodes.forEach((d) => {
    const out = links.filter((l) => l.source === d).sort((a, b) => a.target.y0 - b.target.y0 || a.k - b.k)
    let y = d.y0
    out.forEach((l) => {
      l.y0 = y + l.width / 2
      y += l.width
    })
    const inn = links.filter((l) => l.target === d).sort((a, b) => a.source.y0 - b.source.y0 || a.k - b.k)
    y = d.y0
    inn.forEach((l) => {
      l.y1 = y + l.width / 2
      y += l.width
    })
  })
  return { nodes, links, note, cy, U, R, L, Wt, total, top: 0, bottom: cur }
}

type Sel = Selection<SVGGElement, undefined, null, undefined>

// Draws `lines` as one <text>; `valign` says whether `y` is the block's middle, top or bottom
function drawLabel(
  g: Sel,
  x: number,
  y: number,
  lines: Line[],
  lh: number,
  anchor: 'start' | 'middle' | 'end' = 'start',
  valign: 'middle' | 'top' | 'bottom' = 'middle',
) {
  const h = lines.length * lh
  const top = valign === 'middle' ? y - h / 2 : valign === 'bottom' ? y - h : y
  const t = g.append('text').attr('class', 'lbl').attr('text-anchor', anchor)
  lines.forEach((line, i) => {
    const row = t.append('tspan').attr('x', x).attr('y', top + lh * (i + 0.5)).attr('dy', '0.35em')
    line.forEach((s) => row.append('tspan').attr('class', s.cls ?? null).text(s.text))
  })
}

// Draws `text` as a column name: capitals stacked top to bottom, centred on (x, y)
function drawColName(g: Sel, x: number, y: number, text: string, size: number) {
  const step = size * 0.88
  const chars = [...text.toUpperCase()]
  const top = y - (chars.length * step) / 2
  const t = g.append('text').attr('class', 'colname').attr('text-anchor', 'middle')
  chars.forEach((c, i) => {
    if (c !== ' ') t.append('tspan').attr('x', x).attr('y', top + step * (i + 0.5)).attr('dy', '0.35em').text(c)
  })
}

export function buildSankeySvg(o: SankeyPrintOptions) {
  const F = o.fontSize
  const LH = F * 1.2
  const T = makeText(o.font, F)
  const fmt = (v: number) => v.toFixed(2)
  const sc = F / SRC_FONT
  const GAP = SRC_GAP * sc
  const LOOP_W = SRC_LOOP_W * sc
  const COLNAME = SRC_COLNAME * sc
  // The box column is split in two bars: the climate-impact box (right edge XM) and, GAP further
  // on, the demand chain's root (right edge CX). The column is centred on boxX.
  const XM = o.boxX - (GAP - NW) / 2
  const CX = XM + GAP
  const mx = (x: number) => XM - x

  // ---- Left half: climate impact ----
  const probe = layoutGwp(1000, 1000, LH)
  const pct = (v: number) => ((v / probe.total) * 100).toFixed(1) + '%'
  const valueText = (d: GNode) => fmt(n(d.value)) + (n(d.value) >= 5 ? ` (${pct(n(d.value))})` : '')
  const big = (d: GNode) => d.id !== 'box' && !d.dummy && (!d.rem || n(d.value) >= 1)
  const inner = (d: GNode) => n(d.sourceLinks?.length) > 0
  // The deepest column's labels hang off its left side, so leave room for them at the edge
  const OUTER_MAX = 260
  const outerLabels = probe.G.nodes.filter((d) => big(d) && (d as GNode).layer === probe.maxLayer)
  const leftRoom = Math.max(...outerLabels.map((d) => T.blockWidth(T.nameValue(d.name, valueText(d), OUTER_MAX)))) + 8
  const gwpWidth = XM - o.pad - leftRoom
  // Labels between columns wrap to the gap
  const colGap = (gwpWidth - NW) / probe.maxLayer
  const gwpLabelW = (d: GNode) => ((d as GNode).layer === probe.maxLayer ? OUTER_MAX : colGap - NW - 16)
  const headed = (d: GNode) => HEADED.has(d.id)
  // Headed labels are centred on their bar, so they may spread over the gaps on both sides
  const gwpLines = (d: GNode) =>
    T.nameValue(d.name, valueText(d), headed(d) ? colGap * 1.4 : gwpLabelW(d), inner(d))
  const HEAD_GAP = 6 // between a headed label and its bar
  // Room the headed labels need above their bars, beyond the usual node padding
  const headroom =
    Math.max(...probe.G.nodes.filter(headed).map((d) => gwpLines(d).length * LH)) + 2 * HEAD_GAP - (LH + 3)

  // ---- Right half: demand chain ----
  const CH = CHAIN
  const U = CH.labels.length - 4
  const outLines = (title: string, value: string): Line[] => [[{ text: title, cls: 'ttl' }], [{ text: value, cls: 'v' }]]
  const noteLines: Line[] = [[{ text: 'Not measured', cls: 'ttl' }], [{ text: 'Reuse, composting', cls: 'v' }]]
  const nm = { w: T.blockWidth(noteLines) + 40, h: 2 * LH + 20 }
  const outRoom = Math.max(nm.w, T.width('Waste-to-energy', true), T.width('1.57M tonnes · 2.8%')) + 14
  const rightW = o.width - o.pad - CX
  // Same proportions as the source page (210 / 440 / 720 / 920 plus the split gaps), stretched to the room there is
  const outX = rightW - outRoom - NW
  const base = outX - 2 * GAP
  const X: ChainCols = { ind: (base * 210) / 920, leaf: (base * 440) / 920 + GAP, used: (base * 720) / 920 + GAP, out: outX }
  const leafW = X.used - X.leaf - NW - 24
  // Industry names go on both sides: with their tonnage left of the in bar, "Market share" right of the out bar
  const indInW = X.ind - 14
  const indOutW = X.leaf - (X.ind + GAP + NW) - 14
  const indInLabel = (d: CNode): Line[] => [
    ...T.wrap(d.label, indInW).map((t) => [{ text: t }]),
    [{ text: fmt(d.value) + 'M tonnes', cls: 'v' }],
  ]
  const indOutLabel = (d: CNode): Line[] => [
    ...T.wrap(d.label, indOutW).map((t) => [{ text: t }]),
    [{ text: 'Market share', cls: 'v' }],
  ]
  const leafLabel = (i: number): Line[] => T.wrap(CH.labels[i], leafW).map((t) => [{ text: t }])
  const leafSlot = (i: number) => leafLabel(i).length * LH + 3
  const colNameH = (text: string) => text.length * COLNAME * 0.88
  // The units over the box column sit above the labels beside its top (delivered containerboard
  // on the left, the first industry on the right), in chain coordinates
  const boxUnitsY = (gwp: { G: { nodes: GNode[] } }, boxC: number, chain: ReturnType<typeof layoutChain>) => {
    const toChain = chain.cy - boxC
    const cbm = gwp.G.nodes.find((d) => d.id === 'cbm')!
    const cbmTop = n(cbm.y0) - HEAD_GAP - gwpLines(cbm).length * LH + toChain
    const ind = chain.nodes[1]
    const indTop = (ind.y0 + ind.y1) / 2 - (indInLabel(ind).length * LH) / 2
    return Math.min(chain.nodes[0].y0, cbmTop, indTop) - 6
  }

  // ---- Fit: the tallest layout whose labels stay inside the printed area, box node centred ----
  const layout = (height: number) => {
    const gwp = layoutGwp(gwpWidth, height, LH + 3, headroom)
    const boxC = (n(gwp.box.y0) + n(gwp.box.y1)) / 2
    const chain = layoutChain(n(gwp.box.y1) - n(gwp.box.y0), X, GAP, leafSlot, LH, nm)
    // Vertical reach above and below the box centre, labels included
    let up = 0
    let down = 0
    const reach = (top: number, bottom: number, c: number) => {
      up = Math.max(up, c - top)
      down = Math.max(down, bottom - c)
    }
    gwp.G.nodes.forEach((d) => {
      reach(n(d.y0), n(d.y1), boxC)
      if (headed(d)) {
        const bottom = n(d.y0) - HEAD_GAP
        reach(bottom - gwpLines(d).length * LH, bottom, boxC)
      } else if (big(d)) {
        const h = gwpLines(d).length * LH
        const m = (n(d.y0) + n(d.y1)) / 2
        reach(m - h / 2, m + h / 2, boxC)
      }
    })
    chain.nodes.forEach((d) => reach(d.y0, d.y1, chain.cy))
    chain.nodes.slice(1, 6).forEach((d) => {
      const m = (d.y0 + d.y1) / 2
      const h = Math.max(indInLabel(d).length, indOutLabel(d).length) * LH
      reach(m - h / 2, m + h / 2, chain.cy)
    })
    reach(chain.top, chain.bottom, chain.cy)
    reach(boxUnitsY(gwp, boxC, chain) - LH, chain.nodes[0].y0, chain.cy) // units over the box column
    reach(chain.nodes[U].y0 - LH - 6, chain.nodes[U].y0, chain.cy) // units over the used boxes
    reach(chain.cy - colNameH('Cardboard box') / 2, chain.cy + colNameH('Cardboard box') / 2, chain.cy)
    const um = (chain.nodes[U].y0 + chain.nodes[U].y1) / 2
    reach(um - colNameH('Used cardboard boxes') / 2, um + colNameH('Used cardboard boxes') / 2, chain.cy)
    reach(chain.note.y, chain.note.y + chain.note.h, chain.cy)
    return { gwp, boxC, chain, up, down }
  }
  const fits = (l: ReturnType<typeof layout>) => o.boxY - l.up >= o.pad && o.boxY + l.down <= o.height - o.pad
  let lo = 100
  let hi = o.height * 2
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2
    if (fits(layout(mid))) lo = mid
    else hi = mid
  }
  const { gwp, boxC, chain: C } = layout(lo)
  const G = gwp.G

  // ---- Draw ----
  const root = create('svg')
    .attr('xmlns', 'http://www.w3.org/2000/svg')
    .attr('viewBox', `0 0 ${o.width + (o.bleed ?? 0)} ${o.height}`)
    .attr('font-family', o.font)
  root.append('style').text(`
    .link{fill:none;stroke-opacity:${LINK_OPACITY};mix-blend-mode:multiply}
    .band{fill-opacity:${LINK_OPACITY};mix-blend-mode:multiply}
    .lbl{font-size:${F}px;fill:${TEXT};paint-order:stroke;stroke:${o.halo};stroke-width:${F * 0.3}px;stroke-linejoin:round}
    .v{fill:${TEXT2}}
    .ttl{font-weight:600}
    .colname{font-size:${COLNAME}px;font-weight:650;fill:${MUTED}}
    .dash{fill:none;stroke:${MUTED};stroke-width:1.5;stroke-dasharray:4 4}
  `)
  const loopG = root.append('g') // under both charts
  const linkPath = sankeyLinkHorizontal()

  // Climate impact, mirrored so it flows into the box from the left
  const gwpY = o.boxY - boxC
  const svg = root.append('g').attr('transform', `translate(0,${gwpY})`)
  const mir = svg.append('g').attr('transform', `translate(${XM},0) scale(-1,1)`)
  // The mill → delivered containerboard band is drawn below as fluteboard/linerboard branches
  const split = G.links.find((l) => nodeOf(l.source).id === 'cbm' && nodeOf(l.target).id === 'cbp')
  mir
    .append('g')
    .selectAll('path')
    .data(G.links.filter((l) => l !== split))
    .join('path')
    .attr('class', 'link')
    .attr('d', (d) => linkPath(d as never))
    .attr('stroke', (d) => CAT_COLOR[nodeOf(d.target).cat])
    .attr('stroke-width', (d) => Math.max(1, n(d.width)))
  mir
    .append('g')
    .selectAll('rect')
    .data(G.nodes)
    .join('rect')
    .attr('x', (d) => n(d.x0))
    .attr('y', (d) => n(d.y0))
    .attr('rx', 2)
    .attr('width', (d) => n(d.x1) - n(d.x0))
    .attr('height', (d) => Math.max(2, n(d.y1) - n(d.y0)))
    .attr('fill', (d) => NODE_COLOR[d.cat] ?? CAT_COLOR[d.cat])

  // Fluteboard / linerboard branches between the mill and delivered containerboard.
  // SimaPro gives no split, so the two branches are drawn equal width (not to scale).
  if (split) {
    const xa = mx(n(nodeOf(split.target).x0))
    const xb = mx(n(nodeOf(split.source).x1))
    const xm = (xa + xb) / 2
    const w = n(split.width)
    const hw = w / 2
    const gap = Math.min(40, w / 4)
    const bw = (w - gap) / 2
    const midY = (split.y0! + split.y1!) / 2
    const band = (x1: number, a1: number, b1: number, x2: number, a2: number, b2: number) => {
      const c = (x1 + x2) / 2
      return `M${x1},${a1} C${c},${a1} ${c},${a2} ${x2},${a2} L${x2},${b2} C${c},${b2} ${c},${b1} ${x1},${b1} Z`
    }
    const sub = svg.append('g')
    ;(
      [
        ['Fluteboard', 0, FLUTE],
        ['Linerboard', 1, LINER],
      ] as const
    ).forEach(([name, k, colour]) => {
      const sA = split.y1! - hw + k * hw // band top at mill / delivered
      const tA = split.y0! - hw + k * hw
      const mA = midY - w / 2 + k * (bw + gap) // branch top, kept inside the band's envelope
      sub
        .append('path')
        .attr('d', band(xa, sA, sA + hw, xm, mA, mA + bw) + band(xm, mA, mA + bw, xb, tA, tA + hw))
        .attr('fill', colour)
        .attr('fill-opacity', 0.55)
      drawLabel(sub, xm, mA + bw / 2, [[{ text: name }]], LH, 'middle')
    })
  }

  const labels = svg.append('g')
  G.nodes.filter(big).forEach((d) =>
    headed(d)
      ? drawLabel(labels, mx((n(d.x0) + n(d.x1)) / 2), n(d.y0) - HEAD_GAP, gwpLines(d), LH, 'middle', 'bottom')
      : drawLabel(labels, mx(n(d.x1)) - 6, (n(d.y0) + n(d.y1)) / 2, gwpLines(d), LH, 'end'),
  )

  // Demand chain on the right; its root lines up with the box node, GAP to its right
  const kc = (i: number) => (i < 0 ? CHAIN_ROOT : CHAIN_COLOR[i])
  const chainY = o.boxY - C.cy
  const gc = root.append('g').attr('transform', `translate(${CX},${chainY})`)
  gc.append('g')
    .selectAll('path')
    .data(C.links.filter((l) => l.target.i !== C.R))
    .join('path')
    .attr('class', 'link')
    .attr('d', (d) =>
      linkPath({ source: { x1: d.source.x1 + d.source.xo }, target: { x0: d.target.x0 }, y0: d.y0, y1: d.y1 } as never),
    )
    .attr('stroke', (d) => kc(d.lc))
    .attr('stroke-width', (d) => Math.max(1, d.width))
  // Split columns get a second ("out") bar after their gap
  gc.append('g')
    .selectAll('rect')
    .data(
      C.nodes
        .filter((d) => d.i !== C.R)
        .flatMap((d) => (d.xo ? [{ d, x: d.x0 }, { d, x: d.x0 + d.xo }] : [{ d, x: d.x0 }])),
    )
    .join('rect')
    .attr('x', (b) => b.x)
    .attr('y', (b) => b.d.y0)
    .attr('width', NW)
    .attr('height', (b) => Math.max(2, b.d.h))
    .attr('rx', 2)
    .attr('fill', (b) => (b.d.i === 0 ? CAT_COLOR.box : kc(b.d.cat)))
  const cl = gc.append('g')
  C.nodes
    .filter((d) => d.label && d.i > 5 && d.i < C.U)
    .forEach((d) => drawLabel(cl, d.x1 + 6, (d.y0 + d.y1) / 2, leafLabel(d.i), LH))
  C.nodes.slice(1, 6).forEach((d) => {
    const m = (d.y0 + d.y1) / 2
    drawLabel(cl, d.x0 - 6, m, indInLabel(d), LH, 'end')
    drawLabel(cl, d.x1 + d.xo + 6, m, indOutLabel(d), LH)
  })
  {
    // Units over each split column, on the side they belong to: the left box bar ends the
    // climate-impact chart, the right one starts the tonnes chart; used boxes on the out bar
    const r = C.nodes[0]
    const u = C.nodes[C.U]
    const unit = (x: number, y: number, anchor: 'start' | 'end', text: string) =>
      drawLabel(cl, x, y, [[{ text, cls: 'v' }]], LH, anchor, 'bottom')
    const by = boxUnitsY(gwp, boxC, C)
    unit(r.x0 - GAP + NW, by, 'end', '51.40 ×10⁻⁶ GWP (1 kg)')
    unit(r.x0, by, 'start', C.total.toFixed(1) + 'M tonnes')
    unit(u.x0 + u.xo, u.y0 - 6, 'start', C.total.toFixed(1) + 'M tonnes')
    // Column names in the whitespace of each split column
    const ind = C.nodes[1]
    drawColName(gc, r.x0 - (GAP - NW) / 2, C.cy, 'Cardboard box', COLNAME)
    drawColName(gc, ind.x1 + (GAP - NW) / 2, C.cy, 'Industry', COLNAME)
    drawColName(gc, u.x1 + (GAP - NW) / 2, (u.y0 + u.y1) / 2, 'Used cardboard boxes', COLNAME)
  }
  ;(
    [
      [C.L, 'Landfill', 2.8],
      [C.Wt, 'Waste-to-energy', 0.7],
    ] as const
  ).forEach(([i, name, share]) => {
    const d = C.nodes[i]
    drawLabel(cl, d.x1 + 10, (d.y0 + d.y1) / 2, outLines(name, `${fmt(d.value)}M tonnes · ${share}%`), LH)
  })
  {
    const nt = C.note
    const u = C.nodes[C.U]
    const cy = nt.y + nt.h / 2
    const x = u.x0 + u.xo + 7
    gc.append('path').attr('class', 'dash').attr('d', `M${x},${u.y1 + 4} L${x},${cy} L${nt.x - 4},${cy}`)
    gc.append('rect').attr('class', 'dash').attr('x', nt.x).attr('y', nt.y).attr('width', nt.w).attr('height', nt.h).attr('rx', 6)
    drawLabel(cl, nt.x + nt.w / 2, cy, noteLines, LH, 'middle')
  }

  // Recycling loop: the recycling share of the used boxes leaves through the printed area's right
  // edge and comes back in through its left edge into recovered paper sorting. The two edges meet
  // at the box's glue seam, so on the folded box the ribbon runs on round the corner: it leaves at
  // the height it comes back in, as wide as it re-enters. Schematic, not to scale.
  {
    const rec = C.nodes[C.R]
    const u = C.nodes[C.U]
    const rl = C.links.find((l) => l.target === rec)!
    const wpc = G.nodes.find((d) => d.id === 'wpc')!
    const ye = gwpY + (n(wpc.y0) + n(wpc.y1)) / 2 // where it re-enters, and so where it leaves
    const xe = mx(n(wpc.x1))
    const xs = CX + u.x1 + u.xo
    const ya = chainY + rl.y0 - rl.width / 2
    const yb = ya + rl.width
    const xt = o.width + (o.bleed ?? 0) // on over the glue tab, if there is one
    const xm = (xs + xt) / 2
    const e = LOOP_W / 2
    const colour = CAT_COLOR.recyc
    loopG
      .append('path')
      .attr('class', 'band')
      .attr('d', `M${xs},${ya} C${xm},${ya} ${xm},${ye - e} ${xt},${ye - e} L${xt},${ye + e} C${xm},${ye + e} ${xm},${yb} ${xs},${yb} Z`)
      .attr('fill', colour)
    loopG.append('path').attr('class', 'link').attr('d', `M0,${ye} L${xe},${ye}`).attr('stroke', colour).attr('stroke-width', LOOP_W)
    drawLabel(root.append('g'), xs + 10, (ya + yb) / 2, outLines('Recycling', `${fmt(rec.value)}M tonnes · 96.5%`), LH)
  }

  return root.node()!
}
