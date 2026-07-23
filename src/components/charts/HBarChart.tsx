import { HBAR, hbarHeight, hbarRowY, hbarWidth } from './geometry'

export interface HBarRow {
  label: string
  value: number
  /** bar fill token, e.g. 'var(--it)' */
  fill: string
}

export interface HBarChartProps {
  rows: HBarRow[]
  /** drilled state: the selected bar keeps full opacity + accent ring, the rest dim to .38 */
  selectedIndex?: number | null
  ariaLabel: string
  onBarClick?: (index: number) => void
}

/**
 * Horizontal bar chart (reference: viewBox 508×(rows·25+18), 25px row pitch,
 * labels right-aligned at x=120, bars from x=128 with the max value at 300px,
 * value text 8px after each bar; the drilled bar carries a 2px accent stroke
 * while the others fall to .38 opacity).
 */
export function HBarChart({ rows, selectedIndex, ariaLabel, onBarClick }: HBarChartProps) {
  const max = Math.max(...rows.map((r) => r.value), 0)
  const drilled = selectedIndex !== null && selectedIndex !== undefined
  return (
    <svg className="chart" viewBox={`0 0 ${HBAR.width} ${hbarHeight(rows.length)}`} role="img" aria-label={ariaLabel}>
      {rows.map((r, i) => {
        const y = hbarRowY(i)
        const w = hbarWidth(r.value, max)
        const selected = drilled && i === selectedIndex
        return (
          <g key={i}>
            <text x={HBAR.labelX} y={y + HBAR.textDy} className="cat" textAnchor="end">
              {r.label}
            </text>
            <rect
              className="bar"
              x={HBAR.barX}
              y={y}
              width={w}
              height={HBAR.barHeight}
              rx={HBAR.barRadius}
              fill={r.fill}
              opacity={drilled && !selected ? HBAR.dimOpacity : undefined}
              stroke={selected ? 'var(--accent)' : undefined}
              strokeWidth={selected ? 2 : undefined}
              onClick={onBarClick ? () => onBarClick(i) : undefined}
            />
            <text
              x={HBAR.barX + w + HBAR.valueGap}
              y={y + HBAR.textDy}
              className="val"
              style={selected ? { fill: 'var(--ink)', fontWeight: 600 } : undefined}
            >
              {r.value}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
