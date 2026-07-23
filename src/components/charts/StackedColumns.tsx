import { STACK, fx, stackColX, stackH } from './geometry'

export interface StackedColumn {
  label: string
  met: number
  breached: number
  /** in-progress period: both rects drop to .55 opacity (append '*' to the label yourself) */
  partial?: boolean
}

export interface StackedColumnsProps {
  columns: StackedColumn[]
  /** value of the top grid line; ticks render at 0, ½ and yMax */
  yMax: number
  metFill?: string
  breachedFill?: string
  ariaLabel: string
  onSegmentClick?: (index: number, segment: 'met' | 'breached') => void
}

/**
 * Stacked column chart (reference: viewBox 508×158, three grid lines at
 * y=132/92/52, 46px-wide columns on a 90px pitch from x=62; the met stack
 * rises from the baseline (rx 3) with the breached cap 1px above it (rx 2);
 * a partial column renders both rects at .55 opacity).
 */
export function StackedColumns({
  columns,
  yMax,
  metFill = 'var(--green)',
  breachedFill = 'var(--red)',
  ariaLabel,
  onSegmentClick,
}: StackedColumnsProps) {
  const gridYs = [STACK.baseY, STACK.baseY - STACK.tickStep, STACK.baseY - 2 * STACK.tickStep]
  return (
    <svg className="chart" viewBox={`0 0 ${STACK.width} ${STACK.height}`} role="img" aria-label={ariaLabel}>
      {gridYs.map((gy, i) => (
        <g key={gy}>
          <line className="grid" x1={34} y1={gy} x2={500} y2={gy} />
          <text x={28} y={gy + 3} textAnchor="end">
            {fx((yMax / 2) * i)}
          </text>
        </g>
      ))}
      {columns.map((c, i) => {
        const x = stackColX(i)
        const metH = stackH(c.met, yMax)
        const breachedH = stackH(c.breached, yMax)
        const metY = fx(STACK.baseY - metH)
        const breachedY = fx(metY - STACK.stackGap - breachedH)
        const opacity = c.partial ? STACK.partialOpacity : undefined
        return (
          <g key={i}>
            {metH > 0 && (
              <rect
                className="bar"
                x={x}
                y={metY}
                width={STACK.colWidth}
                height={metH}
                rx={STACK.metRadius}
                fill={metFill}
                opacity={opacity}
                onClick={onSegmentClick ? () => onSegmentClick(i, 'met') : undefined}
              />
            )}
            {breachedH > 0 && (
              <rect
                className="bar"
                x={x}
                y={breachedY}
                width={STACK.colWidth}
                height={breachedH}
                rx={Math.min(STACK.breachedRadius, breachedH / 2)}
                fill={breachedFill}
                opacity={opacity}
                onClick={onSegmentClick ? () => onSegmentClick(i, 'breached') : undefined}
              />
            )}
            <text x={x + STACK.colWidth / 2} y={STACK.catLabelY} className="cat" textAnchor="middle">
              {c.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
