import { DONUT, donutArcs } from './geometry'

export interface DonutSegment {
  value: number
  /** stroke colour token, e.g. 'var(--red)' */
  stroke: string
}

export interface DonutProps {
  segments: DonutSegment[]
  /** big centre figure (e.g. the total) */
  centerValue: string | number
  /** small line under the centre figure */
  centerLabel: string
  ariaLabel: string
  onSegmentClick?: (index: number) => void
}

/**
 * Donut chart (reference: viewBox 150×150 rotated -90° about the centre,
 * r=54 ring with 17px stroke on a --surface track; each segment is a
 * dasharray slice with a 2px gap and cumulative negative dashoffset;
 * centre shows a 22px figure at y=73 over a 9px label at y=89).
 */
export function Donut({ segments, centerValue, centerLabel, ariaLabel, onSegmentClick }: DonutProps) {
  const arcs = donutArcs(segments.map((s) => s.value))
  return (
    <svg className="chart" style={{ width: DONUT.size }} viewBox={`0 0 ${DONUT.size} ${DONUT.size}`} role="img" aria-label={ariaLabel}>
      <g transform={`rotate(-90 ${DONUT.cx} ${DONUT.cy})`}>
        <circle cx={DONUT.cx} cy={DONUT.cy} r={DONUT.r} fill="none" stroke="var(--surface)" strokeWidth={DONUT.strokeWidth} />
        {segments.map((s, i) => (
          <circle
            key={i}
            className={onSegmentClick ? 'bar' : undefined}
            cx={DONUT.cx}
            cy={DONUT.cy}
            r={DONUT.r}
            fill="none"
            stroke={s.stroke}
            strokeWidth={DONUT.strokeWidth}
            strokeDasharray={arcs[i].dasharray}
            strokeDashoffset={arcs[i].dashoffset}
            strokeLinecap="butt"
            onClick={onSegmentClick ? () => onSegmentClick(i) : undefined}
          />
        ))}
      </g>
      <text x={DONUT.cx} y={DONUT.bigTextY} textAnchor="middle" className="big">
        {centerValue}
      </text>
      <text x={DONUT.cx} y={DONUT.bigLabelY} textAnchor="middle" className="biglbl">
        {centerLabel}
      </text>
    </svg>
  )
}
