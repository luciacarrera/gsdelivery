import { useImperativeHandle, useRef, type Ref } from 'react'
import { Quaternion, Vector3 } from 'three'

export type AxisGizmoHandle = { update: (cameraQuaternion: Quaternion) => void }

// Labels follow the Z-up convention, mapped onto three.js world axes so the starting
// view reads z up, x front-right, y back-right (right-handed, like Rhino).
const AXES = [
  { label: 'x', dir: new Vector3(1, 0, 0) },
  { label: 'y', dir: new Vector3(0, 0, -1) },
  { label: 'z', dir: new Vector3(0, 1, 0) },
] as const

const C = 12 // SVG center
const R = 7.5 // axis length
const LABEL_R = 10.5 // label distance from center

// XYZ axis indicator that turns with the camera; call `update` every frame.
export default function AxisGizmo({ ref }: { ref?: Ref<AxisGizmoHandle> }) {
  const groups = useRef<(SVGGElement | null)[]>([])
  const lines = useRef<(SVGLineElement | null)[]>([])
  const labels = useRef<(SVGTextElement | null)[]>([])

  useImperativeHandle(ref, () => {
    const inverse = new Quaternion()
    const v = new Vector3()
    return {
      update(q) {
        inverse.copy(q).invert()
        const depths = AXES.map((axis, i) => {
          // World axis → camera space: x is screen right, y is screen up, z points at the viewer
          v.copy(axis.dir).applyQuaternion(inverse)
          lines.current[i]?.setAttribute('x2', String(C + v.x * R))
          lines.current[i]?.setAttribute('y2', String(C - v.y * R))
          labels.current[i]?.setAttribute('x', String(C + v.x * LABEL_R))
          labels.current[i]?.setAttribute('y', String(C - v.y * LABEL_R))
          groups.current[i]?.setAttribute('opacity', v.z < 0 ? String(0.45 + 0.55 * (1 + v.z)) : '1')
          return v.z
        })
        // Paint back to front so the nearer axes sit on top
        const parent = groups.current[0]?.parentNode
        AXES.map((_, i) => i)
          .sort((a, b) => depths[a] - depths[b])
          .forEach((i) => groups.current[i] && parent?.appendChild(groups.current[i]))
      },
    }
  }, [])

  return (
    <svg viewBox="0 0 24 24" className="h-9 w-9 overflow-visible" aria-hidden>
      {AXES.map((axis, i) => (
        <g key={axis.label} ref={(el) => void (groups.current[i] = el)}>
          <line
            ref={(el) => void (lines.current[i] = el)}
            x1={C}
            y1={C}
            x2={C}
            y2={C}
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
          <text
            ref={(el) => void (labels.current[i] = el)}
            x={C}
            y={C}
            fill="currentColor"
            fontSize="5"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {axis.label}
          </text>
        </g>
      ))}
    </svg>
  )
}
