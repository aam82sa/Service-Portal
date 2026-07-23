/**
 * Shared geometry for the reporting chart primitives. Every constant here is
 * lifted from prototype/reporting-rebuild-reference.html — the components must
 * emit the same coordinates the pixel reference hand-codes, so the maths that
 * produces them lives in one place and the render tests assert against it.
 */

/** round to 2dp so emitted SVG coordinates stay short and stable */
export const fx = (n: number): number => Math.round(n * 100) / 100

/* ---- line/stacked plot frame (viewBox 0 0 508 158) ---- */
export const PLOT = {
  width: 508,
  height: 158,
  /** grid lines span x 34→500; series plot within x 40→496 */
  gridX1: 34,
  gridX2: 500,
  plotX1: 40,
  plotX2: 496,
  /** y of the zero/base grid line and of the top grid line (4-tick charts) */
  baseY: 132,
  topY: 24,
  /** y-axis tick labels sit at x=28, 3px below their grid line */
  tickLabelX: 28,
  /** category labels row */
  catLabelY: 150,
} as const

/** evenly space n points across the plot band, first at plotX1 last at plotX2 */
export function lineX(i: number, n: number): number {
  if (n <= 1) return PLOT.plotX1
  return fx(PLOT.plotX1 + (i * (PLOT.plotX2 - PLOT.plotX1)) / (n - 1))
}

/** map a value to plot y: 0 → baseY (132), yMax → topY (24) */
export function lineY(value: number, yMax: number): number {
  if (yMax <= 0) return PLOT.baseY
  return fx(PLOT.baseY - (value / yMax) * (PLOT.baseY - PLOT.topY))
}

/* ---- horizontal bars (viewBox 0 0 508 rows*25+18) ---- */
export const HBAR = {
  width: 508,
  rowPitch: 25,
  firstRowY: 10,
  barX: 128,
  barHeight: 15,
  barRadius: 4,
  maxBarWidth: 300,
  labelX: 120,
  /** label/value baselines sit 11px below the row's bar top */
  textDy: 11,
  /** value text starts 8px after the bar end (128 + width + 8) */
  valueGap: 8,
  dimOpacity: 0.38,
} as const

export const hbarHeight = (rows: number): number => HBAR.firstRowY + rows * HBAR.rowPitch + 8
export const hbarRowY = (i: number): number => HBAR.firstRowY + i * HBAR.rowPitch
export const hbarWidth = (value: number, max: number): number =>
  max <= 0 ? 0 : fx((value / max) * HBAR.maxBarWidth)

/* ---- donut (viewBox 0 0 150 150) ---- */
export const DONUT = {
  size: 150,
  cx: 75,
  cy: 75,
  r: 54,
  strokeWidth: 17,
  /** gap between segments along the circumference */
  segmentGap: 2,
  bigTextY: 73,
  bigLabelY: 89,
} as const

export const DONUT_CIRCUMFERENCE = fx(2 * Math.PI * DONUT.r) // ≈ 339.29

export interface DonutArc {
  /** stroke-dasharray "length rest" */
  dasharray: string
  /** cumulative negative stroke-dashoffset */
  dashoffset: number
}

/**
 * Convert segment values into dasharray/dashoffset pairs: each segment's arc
 * length is its share of the circumference minus one 2px gap per segment,
 * and each segment is offset by the lengths (plus gaps) before it — the same
 * scheme the reference donut hand-codes.
 */
export function donutArcs(values: number[]): DonutArc[] {
  const total = values.reduce((s, v) => s + v, 0)
  if (total <= 0) return values.map(() => ({ dasharray: `0 ${DONUT_CIRCUMFERENCE}`, dashoffset: 0 }))
  const usable = DONUT_CIRCUMFERENCE - values.length * DONUT.segmentGap
  let consumed = 0
  return values.map((v, i) => {
    const len = fx((v / total) * usable)
    const arc: DonutArc = {
      dasharray: `${len} ${fx(DONUT_CIRCUMFERENCE - len)}`,
      dashoffset: i === 0 ? 0 : fx(-(consumed + i * DONUT.segmentGap)),
    }
    consumed = fx(consumed + len)
    return arc
  })
}

/* ---- stacked columns (viewBox 0 0 508 158) ---- */
export const STACK = {
  width: 508,
  height: 158,
  colWidth: 46,
  colPitch: 90,
  firstColX: 62,
  baseY: 132,
  /** 3-tick chart: grid lines at 132/92/52, i.e. 40px per half-scale */
  tickStep: 40,
  metRadius: 3,
  breachedRadius: 2,
  /** 1px air between the met stack and the breached cap */
  stackGap: 1,
  partialOpacity: 0.55,
  catLabelY: 148,
} as const

export const stackColX = (i: number): number => STACK.firstColX + i * STACK.colPitch
/** map a value to bar height: yMax spans the two 40px grid steps (80px) */
export const stackH = (value: number, yMax: number): number =>
  yMax <= 0 ? 0 : fx((value / yMax) * 2 * STACK.tickStep)
