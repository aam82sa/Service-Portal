/**
 * Geometry + render tests for the chart primitives. Every assertion pins a
 * coordinate scheme lifted from prototype/reporting-rebuild-reference.html —
 * if a component drifts from the pixel reference, a number here breaks.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Sparkline } from './Sparkline'
import { LineChart } from './LineChart'
import { HBarChart } from './HBarChart'
import { Donut } from './Donut'
import { StackedColumns } from './StackedColumns'
import { DONUT_CIRCUMFERENCE, donutArcs, hbarWidth, lineX, lineY } from './geometry'

describe('Sparkline', () => {
  it('renders the reference 76×26 box with a 1.8px round-capped polyline', () => {
    const html = renderToStaticMarkup(<Sparkline values={[3, 5, 4, 8]} stroke="var(--it)" />)
    expect(html).toContain('viewBox="0 0 76 26"')
    expect(html).toContain('class="spark"')
    expect(html).toContain('stroke-width="1.8"')
    expect(html).toContain('stroke-linecap="round"')
    expect(html).toContain('aria-hidden="true"')
  })

  it('maps min/max to the 6px vertical inset and spreads x from 2 to 74', () => {
    const html = renderToStaticMarkup(<Sparkline values={[0, 10]} stroke="var(--it)" />)
    // min → y=20 (26-6), max → y=6; first x=2, last x=74
    expect(html).toContain('points="2,20 74,6"')
  })

  it('draws a midline for a flat series instead of dividing by zero', () => {
    const html = renderToStaticMarkup(<Sparkline values={[5, 5, 5]} stroke="var(--it)" />)
    expect(html).toContain('points="2,13 38,13 74,13"')
  })
})

describe('LineChart', () => {
  const series = [
    { values: [0, 12, 24], stroke: 'var(--it)', area: true },
    { values: [0, 6, 12], stroke: 'var(--green)' },
  ]

  it('renders the reference frame: 508×158, grid at y=132/96/60/24, ticks at x=28', () => {
    const html = renderToStaticMarkup(<LineChart series={series} yMax={24} ariaLabel="trend" />)
    expect(html).toContain('viewBox="0 0 508 158"')
    for (const gy of [132, 96, 60, 24]) {
      expect(html).toContain(`x1="34" y1="${gy}" x2="500" y2="${gy}"`)
    }
    // tick labels 0/8/16/24 sit 3px under their grid line, right-aligned at x=28
    expect(html).toContain('x="28" y="135" text-anchor="end">0</text>')
    expect(html).toContain('x="28" y="27" text-anchor="end">24</text>')
  })

  it('scales values into the x∈[40,496], y∈[24,132] plot band', () => {
    expect(lineX(0, 3)).toBe(40)
    expect(lineX(2, 3)).toBe(496)
    expect(lineY(0, 24)).toBe(132)
    expect(lineY(24, 24)).toBe(24)
    expect(lineY(12, 24)).toBe(78)
    const html = renderToStaticMarkup(<LineChart series={series} yMax={24} ariaLabel="trend" />)
    expect(html).toContain('points="40,132 268,78 496,24"')
  })

  it('closes the area fill down to the baseline at .8 opacity', () => {
    const html = renderToStaticMarkup(<LineChart series={series} yMax={24} ariaLabel="trend" />)
    expect(html).toContain('L496,132 L40,132 Z')
    expect(html).toContain('fill="var(--it-soft)" opacity="0.8"')
  })

  it('rings the highlighted point with r=3 on a card-coloured core', () => {
    const html = renderToStaticMarkup(
      <LineChart series={series} yMax={24} highlight={{ series: 0, index: 1 }} ariaLabel="trend" />,
    )
    expect(html).toContain('cx="268" cy="78" r="3" fill="var(--card)" stroke="var(--it)" stroke-width="2"')
  })

  it('places sparse category labels at the reference anchors', () => {
    const html = renderToStaticMarkup(
      <LineChart series={series} yMax={24} xLabels={{ start: '24 Jun', mid: '8 Jul', end: '22 Jul' }} ariaLabel="trend" />,
    )
    expect(html).toContain('x="40" y="150" class="cat">24 Jun</text>')
    expect(html).toContain('x="268" y="150" class="cat" text-anchor="middle">8 Jul</text>')
    expect(html).toContain('x="496" y="150" class="cat" text-anchor="end">22 Jul</text>')
  })
})

describe('HBarChart', () => {
  const rows = [
    { label: 'IN-02 Access request', value: 24, fill: 'var(--it)' },
    { label: 'IN-01 Hardware', value: 19, fill: 'var(--it)' },
    { label: 'AD-04 Room booking', value: 12, fill: 'var(--admin)' },
  ]

  it('sizes the viewBox to rows·25+18 and lays rows on the 25px pitch from y=10', () => {
    const html = renderToStaticMarkup(<HBarChart rows={rows} ariaLabel="volume" />)
    expect(html).toContain('viewBox="0 0 508 93"')
    expect(html).toContain('y="10"')
    expect(html).toContain('y="35"')
    expect(html).toContain('y="60"')
  })

  it('gives the max value the 300px bar and scales the rest proportionally', () => {
    expect(hbarWidth(24, 24)).toBe(300)
    expect(hbarWidth(12, 24)).toBe(150)
    const html = renderToStaticMarkup(<HBarChart rows={rows} ariaLabel="volume" />)
    expect(html).toContain('x="128" y="10" width="300" height="15" rx="4"')
    expect(html).toContain('x="128" y="60" width="150" height="15" rx="4"')
    // value text starts 8px after the bar end: 128+300+8 / 128+150+8
    expect(html).toContain('x="436" y="21" class="val"')
    expect(html).toContain('x="286" y="71" class="val"')
    // labels right-aligned at x=120, baseline 11px under the bar top
    expect(html).toContain('x="120" y="21" class="cat" text-anchor="end">IN-02 Access request</text>')
  })

  it('drilled state rings the selection with the accent and dims the rest to .38', () => {
    const html = renderToStaticMarkup(<HBarChart rows={rows} selectedIndex={0} ariaLabel="volume" />)
    expect(html).toContain('stroke="var(--accent)" stroke-width="2"')
    expect(html.match(/opacity="0\.38"/g)).toHaveLength(2)
    expect(html).toContain('style="fill:var(--ink);font-weight:600"')
  })

  it('undrilled state dims nothing', () => {
    const html = renderToStaticMarkup(<HBarChart rows={rows} ariaLabel="volume" />)
    expect(html).not.toContain('opacity="0.38"')
    expect(html).not.toContain('stroke="var(--accent)"')
  })
})

describe('Donut', () => {
  it('cuts arcs from C=2π·54 with a 2px gap and cumulative negative offsets', () => {
    expect(DONUT_CIRCUMFERENCE).toBe(339.29)
    const arcs = donutArcs([7, 25, 68, 28]) // usable = 339.29 - 8 = 331.29
    expect(arcs[0]).toEqual({ dasharray: '18.12 321.17', dashoffset: 0 })
    expect(arcs[1].dashoffset).toBe(-20.12) // -(18.12 + 2)
    expect(arcs[2].dashoffset).toBe(-86.83) // -(18.12 + 64.71 + 4)
    expect(arcs[3].dashoffset).toBe(-264.83) // -(18.12 + 64.71 + 176 + 6)
    // every dasharray rest-half is the full circumference minus the arc
    for (const a of arcs) {
      const [len, rest] = a.dasharray.split(' ').map(Number)
      expect(Math.round((len + rest) * 100) / 100).toBe(DONUT_CIRCUMFERENCE)
    }
  })

  it('renders the reference ring: rotate(-90 75 75), r=54, 17px stroke on a surface track', () => {
    const html = renderToStaticMarkup(
      <Donut
        segments={[
          { value: 7, stroke: 'var(--red)' },
          { value: 121, stroke: 'var(--it)' },
        ]}
        centerValue={128}
        centerLabel="open requests"
        ariaLabel="by priority"
      />,
    )
    expect(html).toContain('viewBox="0 0 150 150"')
    expect(html).toContain('transform="rotate(-90 75 75)"')
    expect(html).toContain('stroke="var(--surface)" stroke-width="17"')
    expect(html).toContain('stroke-linecap="butt"')
    expect(html).toContain('x="75" y="73" text-anchor="middle" class="big">128</text>')
    expect(html).toContain('x="75" y="89" text-anchor="middle" class="biglbl">open requests</text>')
  })

  it('handles an all-zero series without NaN arcs', () => {
    const arcs = donutArcs([0, 0])
    expect(arcs[0].dasharray).toBe(`0 ${DONUT_CIRCUMFERENCE}`)
  })
})

describe('StackedColumns', () => {
  const columns = [
    { label: '22 Jun', met: 84, breached: 6 },
    { label: '29 Jun', met: 91, breached: 4 },
    { label: '20 Jul*', met: 41, breached: 2.5, partial: true },
  ]

  it('renders the reference frame: 508×158 with grid at y=132/92/52 and ticks 0/40/80', () => {
    const html = renderToStaticMarkup(<StackedColumns columns={columns} yMax={80} ariaLabel="sla" />)
    expect(html).toContain('viewBox="0 0 508 158"')
    for (const gy of [132, 92, 52]) {
      expect(html).toContain(`x1="34" y1="${gy}" x2="500" y2="${gy}"`)
    }
    expect(html).toContain('y="135" text-anchor="end">0</text>')
    expect(html).toContain('y="95" text-anchor="end">40</text>')
    expect(html).toContain('y="55" text-anchor="end">80</text>')
  })

  it('lays 46px columns on the 90px pitch from x=62, met rising from the baseline', () => {
    const html = renderToStaticMarkup(<StackedColumns columns={columns} yMax={80} ariaLabel="sla" />)
    // W1: met 84 → h=84, y=48; breached 6 → h=6 capped 1px above → y=41 (reference values)
    expect(html).toContain('x="62" y="48" width="46" height="84" rx="3" fill="var(--green)"')
    expect(html).toContain('x="62" y="41" width="46" height="6" rx="2" fill="var(--red)"')
    // W2 starts one 90px pitch later
    expect(html).toContain('x="152" y="41" width="46" height="91" rx="3"')
    // category labels centred under each column
    expect(html).toContain('x="85" y="148" class="cat" text-anchor="middle">22 Jun</text>')
    expect(html).toContain('x="175" y="148" class="cat" text-anchor="middle">29 Jun</text>')
  })

  it('renders the in-progress column at .55 opacity (reference W5: 41/2.5 at x=422… here col 3)', () => {
    const html = renderToStaticMarkup(<StackedColumns columns={columns} yMax={80} ariaLabel="sla" />)
    // met 41 → y=91; breached 2.5 → y=87.5, rx clamps to h/2
    expect(html).toContain('x="242" y="91" width="46" height="41" rx="3" fill="var(--green)" opacity="0.55"')
    expect(html).toContain('height="2.5" rx="1.25" fill="var(--red)" opacity="0.55"')
  })
})
