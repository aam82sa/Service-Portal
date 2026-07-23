import { fx } from './geometry'

export interface SparklineProps {
  values: number[]
  /** stroke colour token, e.g. 'var(--it)' */
  stroke: string
  width?: number
  height?: number
}

/**
 * KPI-card sparkline (reference: 76×26, 1.8px round-capped polyline).
 * Values are normalised into the box with a 6px vertical inset; a flat
 * series draws a midline.
 */
export function Sparkline({ values, stroke, width = 76, height = 26 }: SparklineProps) {
  const inset = { x: 2, y: 6 }
  const n = values.length
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const points = values
    .map((v, i) => {
      const x = n <= 1 ? inset.x : inset.x + (i * (width - 2 * inset.x)) / (n - 1)
      const y = span === 0 ? height / 2 : height - inset.y - ((v - min) / span) * (height - 2 * inset.y)
      return `${fx(x)},${fx(y)}`
    })
    .join(' ')
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
