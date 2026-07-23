import { PLOT, fx, lineX, lineY } from './geometry'

export interface LineSeries {
  values: number[]
  /** stroke colour token, e.g. 'var(--it)' */
  stroke: string
  /** render a soft area fill under this series, closed to the baseline */
  area?: boolean
  /** area fill token; defaults to 'var(--it-soft)' */
  areaFill?: string
}

export interface LineChartProps {
  series: LineSeries[]
  /** value of the top grid line; ticks render at 0, ⅓, ⅔ and yMax */
  yMax: number
  /** sparse category labels along the baseline */
  xLabels?: { start?: string; mid?: string; end?: string }
  /** ring one point: series index + point index */
  highlight?: { series: number; index: number }
  ariaLabel: string
  onPointClick?: (seriesIndex: number, pointIndex: number) => void
}

const GRID_YS = [PLOT.baseY, 96, 60, PLOT.topY]

/**
 * Line/area trend chart (reference: viewBox 508×158, four grid lines at
 * y=132/96/60/24, plot band x∈[40,496], 2px round-joined polylines, soft
 * area fill closed to the baseline, r=3 highlight ring).
 */
export function LineChart({ series, yMax, xLabels, highlight, ariaLabel, onPointClick }: LineChartProps) {
  const ticks = GRID_YS.map((gy, i) => ({ y: gy, label: fx((yMax / 3) * i) }))
  return (
    <svg className="chart" viewBox={`0 0 ${PLOT.width} ${PLOT.height}`} role="img" aria-label={ariaLabel}>
      {GRID_YS.map((gy) => (
        <line key={gy} className="grid" x1={PLOT.gridX1} y1={gy} x2={PLOT.gridX2} y2={gy} />
      ))}
      {ticks.map((t) => (
        <text key={t.y} x={PLOT.tickLabelX} y={t.y + 3} textAnchor="end">
          {t.label}
        </text>
      ))}
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => [lineX(i, s.values.length), lineY(v, yMax)] as const)
        const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ')
        const first = pts[0]
        const last = pts[pts.length - 1]
        return (
          <g key={si}>
            {s.area && first && last && (
              <path
                d={`M${polyline.replace(/ /g, ' L')} L${last[0]},${PLOT.baseY} L${first[0]},${PLOT.baseY} Z`}
                fill={s.areaFill ?? 'var(--it-soft)'}
                opacity={0.8}
              />
            )}
            <polyline
              points={polyline}
              fill="none"
              stroke={s.stroke}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {onPointClick &&
              pts.map(([x, y], pi) => (
                <circle
                  key={pi}
                  cx={x}
                  cy={y}
                  r={7}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onPointClick(si, pi)}
                />
              ))}
          </g>
        )
      })}
      {highlight && series[highlight.series] && (
        <circle
          cx={lineX(highlight.index, series[highlight.series].values.length)}
          cy={lineY(series[highlight.series].values[highlight.index], yMax)}
          r={3}
          fill="var(--card)"
          stroke={series[highlight.series].stroke}
          strokeWidth={2}
        />
      )}
      {xLabels?.start && (
        <text x={PLOT.plotX1} y={PLOT.catLabelY} className="cat">
          {xLabels.start}
        </text>
      )}
      {xLabels?.mid && (
        <text x={268} y={PLOT.catLabelY} className="cat" textAnchor="middle">
          {xLabels.mid}
        </text>
      )}
      {xLabels?.end && (
        <text x={PLOT.plotX2} y={PLOT.catLabelY} className="cat" textAnchor="end">
          {xLabels.end}
        </text>
      )}
    </svg>
  )
}
